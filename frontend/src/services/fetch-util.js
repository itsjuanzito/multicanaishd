// src/services/fetch-util.js

/**
 * Fetch com timeout garantido para evitar que o SSR ou o navegador travem infinitamente.
 * @param {string|URL|Request} resource 
 * @param {RequestInit & { timeout?: number, silent?: boolean }} options 
 */
export async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 5000, silent = false, ...fetchOptions } = options;

    // Detect if we should override Accept-Encoding to 'identity' for TMDB requests to prevent chunked boundary compression bugs
    const resourceUrl = typeof resource === 'string'
        ? resource
        : (resource instanceof URL ? resource.href : (resource.url || ''));

    if (resourceUrl.includes('api.themoviedb.org')) {
        if (!fetchOptions.headers) {
            fetchOptions.headers = {};
        }
        
        // Handle headers as Headers object or plain object
        if (typeof fetchOptions.headers.set === 'function') {
            fetchOptions.headers.set('Accept-Encoding', 'identity');
        } else if (Array.isArray(fetchOptions.headers)) {
            const hasAe = fetchOptions.headers.some(h => h[0]?.toLowerCase() === 'accept-encoding');
            if (!hasAe) {
                fetchOptions.headers.push(['Accept-Encoding', 'identity']);
            }
        } else {
            let found = false;
            for (const key of Object.keys(fetchOptions.headers)) {
                if (key.toLowerCase() === 'accept-encoding') {
                    fetchOptions.headers[key] = 'identity';
                    found = true;
                    break;
                }
            }
            if (!found) {
                fetchOptions.headers['Accept-Encoding'] = 'identity';
            }
        }
    }

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    if (options.signal) {
        if (options.signal.aborted) {
            controller.abort();
        } else {
            options.signal.addEventListener('abort', () => controller.abort());
        }
    }

    try {
        const response = await fetch(resource, {
            ...fetchOptions,
            signal: controller.signal
        });

        // O timeout NÃO é cancelado aqui. O AbortController é o único teto que cobre a
        // LEITURA do corpo, e cancelá-lo assim que os headers chegam (como era antes)
        // deixava todo res.json()/res.text() do projeto sem teto nenhum: um corpo que
        // estagna pendura o SSR pra sempre e a resposta HTTP nunca fecha.
        // Em vez disso, o timer é cancelado quando o corpo é consumido — e se isso nunca
        // acontecer, ele dispara sozinho e aborta o stream.
        try {
            for (const method of ['json', 'text', 'arrayBuffer', 'blob', 'formData']) {
                const original = response[method];
                if (typeof original !== 'function') continue;
                response[method] = function (...args) {
                    return original.apply(this, args).finally(() => clearTimeout(id));
                };
            }
        } catch {
            // Response imutável em algum runtime: deixa o timer armado, que ainda é o
            // comportamento seguro (aborta um corpo travado em vez de pendurar).
        }

        return response;
    } catch (error) {
        clearTimeout(id);
        if ((error.name === 'AbortError' || error.name === 'TimeoutError') && !silent) {
            console.warn(`⏳ Fetch Timeout (${timeout}ms): ${resource} - Iniciando fallback...`);
        }
        throw error;
    }
}
