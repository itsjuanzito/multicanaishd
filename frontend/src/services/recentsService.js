import { getEnv } from "./env-adapter.js";
import { fetchWithTimeout } from "./fetch-util.js";
import { axiomService } from "./axiom-service.js";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 60;

function getStreamBetterBaseUrl() {
    return getEnv("STREAMBETTER_API_URL", "https://streambetter.netlify.app").replace(/\/$/, "");
}

function toPositiveInt(value, fallback, max = Number.MAX_SAFE_INTEGER) {
    const num = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(num) || num <= 0) return fallback;
    return Math.min(num, max);
}

function toBoolean(value, fallback = false) {
    if (value === null || value === undefined) return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
    return fallback;
}

export function parseRecentsParams(url) {
    return {
        page: toPositiveInt(url.searchParams.get("page"), DEFAULT_PAGE),
        limit: toPositiveInt(url.searchParams.get("limit"), DEFAULT_LIMIT, MAX_LIMIT),
        force: toBoolean(url.searchParams.get("force"), false),
    };
}

/**
 * Resposta padrão quando o upstream StreamBetter cai ou estoura o timeout de 10s.
 *
 * Antes cada uma das 4 rotas de /api/recents repetia esse catch devolvendo **500**, e eram
 * os únicos 500 do site inteiro (27 em 24h em /api/recents, mais 8 nas variantes). 500 é a
 * resposta errada: o defeito não é nosso, é um terceiro indisponível — os erros gêmeos
 * "The operation was aborted" do channelsService no Axiom são o mesmo fenômeno. 503 +
 * Retry-After diz a verdade pro cliente, não suja o painel de erros da Cloudflare com falha
 * alheia e sinaliza pra não insistir imediatamente.
 *
 * Também loga: o catch antigo era silencioso, então a causa dos 500 não aparecia em lugar
 * nenhum — só dava pra ver que existiam.
 */
export function respostaFalhaRecents(error, endpoint) {
    axiomService.logError(error, { servico: "recentsService", rota: endpoint }).catch(() => {});

    return new Response(
        JSON.stringify({
            success: false,
            error: `Falha ao buscar ${endpoint}`,
            detail: error?.message || "Unexpected error",
        }),
        {
            status: 503,
            headers: {
                "Content-Type": "application/json",
                "Retry-After": "30",
                "Cache-Control": "no-store",
            },
        }
    );
}

/**
 * Cabeçalhos da resposta de /api/recents. Falha nunca entra no cache da borda: um 503
 * cacheado por 60s propagaria a indisponibilidade do upstream pra quem chegasse depois,
 * mesmo já tendo voltado ao ar.
 */
export function headersRecents(result, params) {
    if (!result.ok) {
        const h = { "Content-Type": "application/json", "Cache-Control": "no-store" };
        if (result.status === 503) h["Retry-After"] = "30";
        return h;
    }

    return {
        "Content-Type": "application/json",
        "Cache-Control": params.force
            ? "no-store, max-age=0"
            : "public, s-maxage=60, stale-while-revalidate=120",
    };
}

export async function fetchRecents(kind, params) {
    const base = getStreamBetterBaseUrl();
    const suffix = kind ? `/${kind}` : "";
    const target = new URL(`${base}/api/recents${suffix}`);
    target.searchParams.set("page", String(params.page));
    target.searchParams.set("limit", String(params.limit));
    if (params.force) {
        target.searchParams.set("force", "true");
    }

    const response = await fetchWithTimeout(target.toString(), {
        timeout: 10000,
        headers: {
            Accept: "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; MultiCanaisHDAPI/1.0)",
        },
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => "");

        // 5xx do upstream NÃO é espelhado. Repassar o 500 do StreamBetter fazia o defeito de
        // um terceiro ser contabilizado como erro nosso — eram os únicos 500 do site no painel
        // da Cloudflare, e este caminho (upstream respondendo, mas com erro) é o que realmente
        // acontecia em produção; o catch das rotas só pegava timeout/exceção. 503 + Retry-After
        // descreve a situação certa: o serviço está temporariamente indisponível por dependência
        // externa. 4xx continua espelhado, porque aí o problema é do pedido, não do upstream.
        const indisponivel = response.status >= 500;
        if (indisponivel) {
            axiomService.logError(
                new Error(`Upstream StreamBetter respondeu ${response.status}`),
                { servico: "recentsService", rota: `/api/recents${suffix}`, statusUpstream: response.status }
            ).catch(() => {});
        }

        return {
            ok: false,
            status: indisponivel ? 503 : response.status,
            body: {
                success: false,
                error: `Upstream StreamBetter error (${response.status})`,
                detail: errorText?.slice(0, 300) || response.statusText || "Unknown upstream error",
                endpoint: `/api/recents${suffix}`,
            },
        };
    }

    const data = await response.json();
    return { ok: true, status: 200, body: data };
}

