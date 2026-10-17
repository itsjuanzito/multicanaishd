import { supabaseAdmin } from "../../services/supabase";

export async function POST({ request }) {
    try {
        const { url: pageUrl, signal } = await request.json();
        if (!pageUrl || signal !== "sandbox_restricted") {
            return new Response(null, { status: 204 });
        }

        const parsed = new URL(pageUrl);
        const domain = parsed.hostname;

        // Ignora domínios internos
        if (domain.includes('multicanaishd') || domain === 'localhost' || domain === '127.0.0.1') {
            return new Response(null, { status: 204 });
        }

        await supabaseAdmin.rpc('increment_ad_integrity', {
            // Hostname (não a URL): uma linha por site, em vez de uma por página visitada.
            p_domain: domain.replace(/^www\./, '').toLowerCase(),
            p_last_detected: new Date().toISOString()
        });
    } catch (e) {
        console.error("[Track Ad Integrity API] Error:", e);
    }

    return new Response(null, { status: 204 });
}
