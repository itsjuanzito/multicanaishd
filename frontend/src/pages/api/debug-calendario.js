import { fetchWithTimeout } from "../../services/fetch-util.js";
import { getConfig } from "../../services/configService.js";

export const prerender = false;

export async function GET() {
    try {
        const defaultDomains = 'https://superflixapi.online,https://superflixapi.buzz,https://superflixapi.asia';
        const domainsStr = await getConfig('SUPERFLIX_DOMAINS', defaultDomains);
        const domains = domainsStr.split(',').map(d => d.trim()).filter(Boolean);
        
        const results = [];
        
        for (const domain of domains) {
            try {
                const url = `${domain}/calendario.php`;
                const res = await fetchWithTimeout(url, { timeout: 5000 });
                results.push({
                    domain,
                    status: res.status,
                    ok: res.ok,
                    length: res.ok ? (await res.text()).length : 0
                });
            } catch (e) {
                results.push({
                    domain,
                    status: 'error',
                    reason: e.message
                });
            }
        }

        return new Response(JSON.stringify({
            status: 'ok',
            results
        }), { 
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (e) {
        return new Response(JSON.stringify({ status: 'error', reason: e.message }), { 
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
