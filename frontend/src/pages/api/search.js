import { getEnv } from '../../services/env-adapter.js';
import { isKidsRequest, filtrarItensInfantis, headersSemCacheInfantil } from '../../services/kidsProfile.js';
import { reforcarComClassificacao } from '../../services/contentRating.js';

// Cache em memória para buscas
const searchCache = new Map();
const CACHE_DURATION = 300000; // 5 minutos

export async function GET({ request }) {
    try {
        const url = new URL(request.url);
        const query = url.searchParams.get('q');
        const lang = url.searchParams.get('lang') || 'pt';
        
        if (!query) {
            return new Response(
                JSON.stringify({ error: 'Parâmetro q é obrigatório' }),
                {
                    status: 400,
                    headers: { "Content-Type": "application/json" }
                }
            );
        }

        // Verificar cache
        const tmdbLang = lang === 'en' ? 'en-US' : 'pt-BR';
        // O perfil entra na chave: sem isso a primeira busca feita numa conta infantil
        // serviria a lista podada para todo mundo pelos 5 minutos seguintes.
        const kids = isKidsRequest(request);
        const cacheKey = `${tmdbLang}_${kids ? 'kids_' : ''}${query.toLowerCase().trim()}`;
        const cached = searchCache.get(cacheKey);
        
        if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
            console.log('✅ Retornando busca do cache:', query, `[${lang}]`);
            return new Response(JSON.stringify(cached.data), {
                status: 200,
                headers: {
                    "Content-Type": "application/json",
                    "Cache-Control": "public, max-age=300, s-maxage=300"
                }
            });
        }

        console.log('🔍 Buscando no TMDB:', query, `[${lang}]`);

        // Buscar apenas uma página inicialmente para melhor performance
        const tmdbUrl = `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(query)}&language=${tmdbLang}&page=1&include_adult=false`;
        
        const tmdbResponse = await fetch(tmdbUrl, {
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${getEnv('KEY_API_TMDB') || getEnv('TMDB_API_KEY')}`
            }
        });

        if (!tmdbResponse.ok) {
            throw new Error(`TMDB API error: ${tmdbResponse.status}`);
        }

        const tmdbData = await tmdbResponse.json();

        let results = tmdbData.results || [];
        let exibindoSugestao = false;
        let sugestaoQuery = "";

        // Fallback inteligente para correções ortográficas (Spellcheck)
        if (results.length === 0 && query.trim().length > 2) {
            try {
                const suggestUrl = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`;
                const suggestRes = await fetch(suggestUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
                });
                if (suggestRes.ok) {
                    const suggestData = await suggestRes.json();
                    const suggestions = suggestData[1] || [];
                    const validSuggestions = suggestions.filter(s => s && s.toLowerCase().trim() !== query.toLowerCase().trim());
                    if (validSuggestions.length > 0) {
                        let cleanSug = validSuggestions[0].replace(/\b(filme|serie|anime|netflix|onde assistir|completo|dublado|legendado|assistir|gratis|online|elenco|sinopse|critica|significado|tradução|revenge|2026)\b/gi, '').trim();
                        if (!cleanSug) cleanSug = validSuggestions[0];
                        
                        if (cleanSug && cleanSug.toLowerCase().trim() !== query.toLowerCase().trim()) {
                            const tmdbUrlSuggest = `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(cleanSug)}&language=${tmdbLang}&page=1&include_adult=false`;
                            const tmdbResponseSuggest = await fetch(tmdbUrlSuggest, {
                                headers: {
                                    'Accept': 'application/json',
                                    'Authorization': `Bearer ${getEnv('KEY_API_TMDB') || getEnv('TMDB_API_KEY')}`
                                }
                            });
                            if (tmdbResponseSuggest.ok) {
                                const tmdbDataSuggest = await tmdbResponseSuggest.json();
                                if (tmdbDataSuggest.results && tmdbDataSuggest.results.length > 0) {
                                    results = tmdbDataSuggest.results;
                                    exibindoSugestao = true;
                                    sugestaoQuery = cleanSug;
                                }
                            }
                        }
                    }
                }
            } catch (suggestErr) {
                console.error("Erro ao buscar did-you-mean sugestões na API /search:", suggestErr);
            }
        }

        const resultadosFinais = kids ? await reforcarComClassificacao(filtrarItensInfantis(results)) : results;

        const resultados = {
            page: tmdbData.page,
            results: resultadosFinais,
            total_pages: tmdbData.total_pages,
            total_results: tmdbData.total_results,
            exibindoSugestao,
            sugestaoQuery
        };

        console.log(`[API /search] Query: "${query}" | Found: ${resultados.results.length} items`);

        // Salvar no cache
        searchCache.set(cacheKey, {
            data: resultados,
            timestamp: Date.now()
        });

        // Limpar cache antigo periodicamente
        const now = Date.now();
        for (let [key, value] of searchCache.entries()) {
            if (now - value.timestamp > CACHE_DURATION) {
                searchCache.delete(key);
            }
        }

        const headers = {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=300, s-maxage=300"
        };

        return new Response(JSON.stringify(resultados), {
            status: 200,
            headers: kids ? headersSemCacheInfantil(headers) : headers
        });

    } catch (error) {
        console.error('❌ Erro na busca:', error);
        
        // Retornar resultados vazios em vez de erro para melhor UX
        return new Response(
            JSON.stringify({
                page: 1,
                results: [],
                total_pages: 0,
                total_results: 0,
                error: 'Busca temporariamente indisponível'
            }),
            {
                status: 200, // Mantém 200 para não quebrar a página
                headers: { 
                    "Content-Type": "application/json",
                    "Cache-Control": "no-cache"
                }
            }
        );
    }
}