// src/services/streamEmbedService.js
// Constrói URLs de embed público da StreamBetter (filme/série/canal/jogo/evento).
// Sem chamadas de rede — só monta string a partir da chave pública (sb_pk_...).
import { getEnv } from './env-adapter.js';

export function getShopUrl() {
    return getEnv('STREAMBETTER_SHOP_URL', 'https://streambetter.lol').replace(/\/$/, '');
}

export function getEmbedPublicKey() {
    return getEnv('STREAMBETTER_EMBED_PUBLIC_KEY', '');
}

// kind: 'movie' | 'episode' | 'channel' | 'game' | 'event'
// includeKey: a chave é o que tira o anúncio da StreamBetter dentro do iframe — quem chama
// decide se o viewer atual tem direito a isso (VIP) ou não. Default true porque os únicos
// consumidores sem contexto de VIP por viewer são feeds públicos (canais.json.js/jogos.json.js).
export function buildEmbedUrl({ kind, tmdbId, season, episode, slug, includeKey = true }) {
    const base = getShopUrl();
    const path = {
        movie: `/filme/${tmdbId}`,
        episode: `/serie/${tmdbId}/${season}/${episode}`,
        channel: `/canal/${slug}`,
        game: `/jogo/${slug}`,
        event: `/evento/${slug}`,
    }[kind];
    if (!path) return null;

    const params = new URLSearchParams();
    if (includeKey) {
        const key = getEmbedPublicKey();
        if (key) params.set('key', key);
    }
    const qs = params.toString();
    return qs ? `${base}${path}?${qs}` : `${base}${path}`;
}
