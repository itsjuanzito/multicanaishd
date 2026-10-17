// src/pages/api/admin/check-urls.js
//
// Checagem sob demanda de URLs soltas (painel /moderacao). Auth idêntica a url-rotations.js:
// mesmo ADMIN_MODERATION_TOKEN, aceito por header Authorization, ?token= ou corpo — cada
// caminho em `if` independente (code.md §2.1), nunca em cadeia `else`.
import { setRuntimeEnv, getEnv } from "../../../services/env-adapter.js";
import { checarUrls, MAX_URLS_POR_CHAMADA } from "../../../services/urlCheckerService.js";

export const prerender = false;

function json(corpo, status = 200) {
    return new Response(JSON.stringify(corpo), {
        status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
}

function autorizado(request, urlObj, tokenDoCorpo) {
    const ADMIN_TOKEN = getEnv('ADMIN_MODERATION_TOKEN');
    if (!ADMIN_TOKEN) return false;

    const doCorpo = typeof tokenDoCorpo === 'string' ? tokenDoCorpo : '';
    const daQuery = urlObj.searchParams.get('token') || '';
    const doHeader = request.headers.get("Authorization")?.replace("Bearer ", "") || '';

    let ok = false;
    if (doCorpo === ADMIN_TOKEN) ok = true;
    if (!ok && daQuery === ADMIN_TOKEN) ok = true;
    if (!ok && doHeader === ADMIN_TOKEN) ok = true;
    return ok;
}

export async function POST({ request, locals }) {
    if (locals?.runtime?.env) {
        setRuntimeEnv(locals.runtime.env);
    }
    const urlObj = new URL(request.url);

    // O token pode vir no corpo, então o JSON é lido antes da autorização. Falha de parse não
    // vira 500: sem corpo, a autorização simplesmente não acha token e responde 401.
    let body = null;
    try {
        body = await request.json();
    } catch (e) {
        body = null;
    }

    if (!autorizado(request, urlObj, body?.token)) {
        return json({ error: "Não autorizado" }, 401);
    }

    const urls = Array.isArray(body?.urls) ? body.urls : [];
    if (urls.length === 0) {
        return json({ error: "Envie 'urls' como uma lista não vazia." }, 400);
    }
    if (urls.length > MAX_URLS_POR_CHAMADA) {
        return json({ error: `Máximo de ${MAX_URLS_POR_CHAMADA} URLs por chamada.` }, 400);
    }

    try {
        const results = await checarUrls(urls, urlObj.origin);
        return json({ success: true, total: results.length, results });
    } catch (error) {
        // Regra §4.2: nunca 5xx. Uma falha inesperada devolve lista vazia + motivo, com 200.
        console.error("[Check URLs API] Falha inesperada:", error);
        return json({
            success: false,
            total: 0,
            results: [],
            error: error?.message || 'Falha ao checar as URLs.',
        });
    }
}
