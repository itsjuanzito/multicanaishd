// src/services/twitterService.js
// Postagem de tweets via X API v2 (POST /2/tweets) autenticada com OAuth 1.0a user context,
// que é o único método de auth que permite postar tweets no plano gratuito da X API.
// Assinatura HMAC-SHA1 feita com Web Crypto (SubtleCrypto) em vez de node:crypto para
// funcionar tanto no runtime do Cloudflare Worker quanto no script Node do GitHub Actions.

import { getEnv } from "./env-adapter.js";
import { fetchWithTimeout } from "./fetch-util.js";

const TWEET_ENDPOINT = "https://api.twitter.com/2/tweets";
const TWEET_MAX_LENGTH = 280;

function percentEncode(str) {
    return encodeURIComponent(str).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildOAuthHeader(method, url, oauthParams) {
    const sorted = Object.keys(oauthParams).sort().map((k) => `${percentEncode(k)}=${percentEncode(oauthParams[k])}`);
    return `OAuth ${sorted.map((pair) => {
        const [k, v] = pair.split("=");
        return `${k}="${v}"`;
    }).join(", ")}`;
}

async function hmacSha1Base64(key, message) {
    const enc = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
        "raw",
        enc.encode(key),
        { name: "HMAC", hash: "SHA-1" },
        false,
        ["sign"]
    );
    const signature = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

function randomNonce() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function signRequest({ method, url, consumerKey, consumerSecret, accessToken, accessTokenSecret }) {
    const oauthParams = {
        oauth_consumer_key: consumerKey,
        oauth_nonce: randomNonce(),
        oauth_signature_method: "HMAC-SHA1",
        oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
        oauth_token: accessToken,
        oauth_version: "1.0"
    };

    // POST /2/tweets não usa parâmetros de query/form no cálculo da assinatura (body é JSON, não form-urlencoded)
    const baseParams = Object.keys(oauthParams).sort().map((k) => `${percentEncode(k)}=${percentEncode(oauthParams[k])}`).join("&");
    const signatureBase = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(baseParams)}`;
    const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(accessTokenSecret)}`;

    oauthParams.oauth_signature = await hmacSha1Base64(signingKey, signatureBase);

    return buildOAuthHeader(method, url, oauthParams);
}

function truncateForTweet(text, reservedForLink = 0) {
    const limit = TWEET_MAX_LENGTH - reservedForLink;
    if (text.length <= limit) return text;
    return `${text.slice(0, Math.max(0, limit - 1))}…`;
}

/**
 * Monta o texto do tweet a partir dos mesmos dados usados no embed do Discord.
 * X encurta qualquer URL para 23 caracteres via t.co, então reservamos esse espaço fixo.
 */
export function buildTweetText({ emoji, title, subtitle, link }) {
    const T_CO_LENGTH = 23;
    const suffix = `\n\n${link}`;
    const header = subtitle ? `${emoji} ${title}\n${subtitle}` : `${emoji} ${title}`;
    const truncatedHeader = truncateForTweet(header, T_CO_LENGTH + 2);
    return `${truncatedHeader}${suffix}`;
}

/**
 * Posta um tweet via X API v2. Retorna { ok, id?, error? } — nunca lança, para que uma falha
 * de Twitter nunca derrube o restante do cron (Discord já processado antes desta chamada).
 */
export async function postTweet(text) {
    const consumerKey = getEnv("TWITTER_API_KEY");
    const consumerSecret = getEnv("TWITTER_API_SECRET");
    const accessToken = getEnv("TWITTER_ACCESS_TOKEN");
    const accessTokenSecret = getEnv("TWITTER_ACCESS_TOKEN_SECRET");

    if (!consumerKey || !consumerSecret || !accessToken || !accessTokenSecret) {
        return { ok: false, skipped: true, error: "Credenciais do Twitter/X ausentes." };
    }

    try {
        const authHeader = await signRequest({
            method: "POST",
            url: TWEET_ENDPOINT,
            consumerKey,
            consumerSecret,
            accessToken,
            accessTokenSecret
        });

        const res = await fetchWithTimeout(TWEET_ENDPOINT, {
            timeout: 8000,
            method: "POST",
            headers: {
                "Authorization": authHeader,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ text })
        });

        const bodyText = await res.text().catch(() => "");
        let bodyJson = {};
        try { bodyJson = JSON.parse(bodyText || "{}"); } catch {}

        if (!res.ok) {
            return { ok: false, status: res.status, error: bodyJson?.detail || bodyText };
        }

        return { ok: true, id: bodyJson?.data?.id };
    } catch (error) {
        return { ok: false, error: error?.message || String(error) };
    }
}
