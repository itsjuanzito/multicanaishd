// src/pages/api/recommend.js - COM RETRY E FALLBACK

import { GoogleGenerativeAI } from "@google/generative-ai";
import { getSuperflixIds } from "../../services/superflix-ids.js";

const genAI = new GoogleGenerativeAI(import.meta.env.GEMINI_API_KEY);

export const config = {
  runtime: 'edge',
};

// ✅ Função para tentar gerar títulos com retry
async function generateTitlesWithRetry(userQuery, maxRetries = 3) {
    const prompt = `Você é um especialista em cinema e séries. Sua tarefa é sugerir 20 títulos VARIADOS que correspondem à busca do usuário.

BUSCA DO USUÁRIO: "${userQuery}"

REGRAS IMPORTANTES:
1. Liste APENAS títulos REAIS que existem
2. Use títulos ORIGINAIS (inglês, coreano, japonês, etc.) - TMDB usa títulos originais
3. Seja CRIATIVO - não sugira sempre os mesmos títulos populares
4. Misture clássicos E lançamentos recentes
5. Para doramas: use títulos coreanos originais EM INGLÊS (ex: "Squid Game", não "Round 6")
6. Para animes: use títulos japoneses em inglês (ex: "Attack on Titan")
7. VARIE suas sugestões - pense fora da caixa

IMPORTANTE: Não repita sempre os mesmos títulos. Explore todo o universo do tema solicitado.

RETORNE APENAS JSON sem formatação markdown:
{
  "titles": ["título1", "título2", "título3", ...]
}`;

    // Tentar com diferentes modelos e configs
    const strategies = [
        { model: "gemini-2.5-flash", temp: 0.7 },
        { model: "gemini-2.5-flash-lite", temp: 0.7 },
        { model: "gemini-2.0-flash-lite", temp: 0.5 },
    ];

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const strategy = strategies[Math.min(attempt, strategies.length - 1)];
        
        try {
            console.log(`🤖 Tentativa ${attempt + 1}/${maxRetries} - Modelo: ${strategy.model}`);
            
            const model = genAI.getGenerativeModel({ 
                model: strategy.model,
                generationConfig: { 
                    temperature: strategy.temp,
                }
            });

            const result = await model.generateContent(prompt);
            const text = result.response.text().trim();
            
            let jsonText = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            const firstBrace = jsonText.indexOf('{');
            const lastBrace = jsonText.lastIndexOf('}');
            
            if (firstBrace !== -1 && lastBrace !== -1) {
                jsonText = jsonText.substring(firstBrace, lastBrace + 1);
                const parsed = JSON.parse(jsonText);
                
                if (parsed.titles && Array.isArray(parsed.titles) && parsed.titles.length > 0) {
                    console.log(`✅ IA gerou ${parsed.titles.length} títulos com ${strategy.model}`);
                    return parsed.titles;
                }
            }
            
            throw new Error('Resposta inválida da IA');
            
        } catch (error) {
            console.warn(`⚠️ Tentativa ${attempt + 1} falhou:`, error.message);
            
            // Se não for o último retry, aguardar antes de tentar novamente
            if (attempt < maxRetries - 1) {
                const waitTime = Math.min(1000 * Math.pow(2, attempt), 5000); // Exponential backoff
                console.log(`⏳ Aguardando ${waitTime}ms antes de tentar novamente...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }
    
    // Se todas as tentativas falharam, retornar fallback baseado em keywords
    console.log('⚠️ Todas as tentativas falharam, usando fallback...');
    return generateFallbackTitles(userQuery);
}

// ✅ Fallback: gerar títulos básicos baseados em keywords
function generateFallbackTitles(query) {
    const lowerQuery = query.toLowerCase();
    
    // Detectar tipo de conteúdo
    const isDorama = lowerQuery.includes('dorama') || lowerQuery.includes('coreano') || lowerQuery.includes('coreia');
    const isAnime = lowerQuery.includes('anime') || lowerQuery.includes('japon');
    const isAction = lowerQuery.includes('ação') || lowerQuery.includes('action');
    const isRomance = lowerQuery.includes('romance') || lowerQuery.includes('amor');
    const isComedy = lowerQuery.includes('comédia') || lowerQuery.includes('engraçado');
    const isHorror = lowerQuery.includes('terror') || lowerQuery.includes('horror');
    
    let titles = [];
    
    if (isDorama && isAction) {
        titles = ["Squid Game", "Sweet Home", "All of Us Are Dead", "My Name", "D.P.", 
                  "Kingdom", "Vincenzo", "The Glory", "Bloodhounds", "Moving",
                  "City Hunter", "Vagabond", "Bad and Crazy", "The K2", "Healer"];
    } else if (isDorama && isRomance) {
        titles = ["Crash Landing on You", "Business Proposal", "True Beauty", "My Love from the Star",
                  "Descendants of the Sun", "Goblin", "What's Wrong with Secretary Kim", "Strong Woman Do Bong Soon"];
    } else if (isAnime && isAction) {
        titles = ["Attack on Titan", "Demon Slayer", "My Hero Academia", "One Punch Man", "Jujutsu Kaisen",
                  "Fullmetal Alchemist", "Death Note", "Tokyo Ghoul", "Hunter x Hunter"];
    } else if (isAction) {
        titles = ["John Wick", "Fast and Furious", "Mission Impossible", "The Dark Knight", "Mad Max Fury Road",
                  "Die Hard", "Extraction", "Nobody", "The Raid", "Atomic Blonde"];
    } else if (isRomance) {
        titles = ["The Notebook", "La La Land", "Pride and Prejudice", "Titanic", "About Time",
                  "Eternal Sunshine", "500 Days of Summer", "Before Sunrise"];
    } else if (isComedy) {
        titles = ["The Hangover", "Superbad", "Step Brothers", "Bridesmaids", "21 Jump Street",
                  "Crazy Stupid Love", "The Grand Budapest Hotel", "Ted"];
    } else if (isHorror) {
        titles = ["The Conjuring", "Get Out", "A Quiet Place", "Hereditary", "It",
                  "The Shining", "Sinister", "Insidious", "The Ring"];
    } else {
        titles = ["The Shawshank Redemption", "Inception", "Interstellar", "The Matrix", "Pulp Fiction",
                  "The Godfather", "Breaking Bad", "Game of Thrones", "Stranger Things", "The Office"];
    }
    
    console.log(`📋 Fallback gerou ${titles.length} títulos baseados em keywords`);
    return titles;
}

export async function POST({ request }) {
    try {
        const headers = {
            "Content-Type": "application/json",
            "Cache-Control": "no-cache, no-store, must-revalidate",
        };
        
        const { userQuery } = await request.json();
        
        if (!userQuery || userQuery.trim().length === 0) {
            return new Response(JSON.stringify({
                error: 'Por favor, descreva o que você quer assistir'
            }), { status: 400, headers });
        }

        console.log(`🔍 BUSCA: "${userQuery}"`);
        const tmdbToken = import.meta.env.KEY_API_TMDB;

        // 1. PEGAR CATÁLOGO
        console.log('📡 [Recommend API] Buscando catálogo de IDs via serviço...');
        const catalogData = await getSuperflixIds();
        const allCatalogIds = new Set();
        
        if (catalogData?.movies) catalogData.movies.forEach(id => allCatalogIds.add(id));
        if (catalogData?.series) catalogData.series.forEach(id => allCatalogIds.add(id));
        if (catalogData?.anime) catalogData.anime.forEach(id => allCatalogIds.add(id));
        if (catalogData?.doramas) catalogData.doramas.forEach(id => allCatalogIds.add(id));

        console.log('📚 Catálogo:', allCatalogIds.size, 'IDs');

        // 2. 🤖 IA GERA LISTA DE TÍTULOS (COM RETRY)
        console.log('🤖 IA gerando títulos...');
        
        const suggestedTitles = await generateTitlesWithRetry(userQuery);
        
        if (suggestedTitles.length === 0) {
            return new Response(JSON.stringify({
                error: 'Não consegui gerar sugestões para sua busca'
            }), { status: 404, headers });
        }

        console.log(`📝 Títulos: ${suggestedTitles.slice(0, 5).join(', ')}...`);

        // 3. 🔎 BUSCAR CADA TÍTULO NO TMDB (BUSCA MELHORADA E PARALELIZADA)
        console.log('🔎 Buscando títulos no TMDB...');
        
        const foundItems = [];
        const processedIds = new Set();
        const TMDB_TIMEOUT = 4000; // SLA de 4s por request do TMDB

        // Função auxiliar para buscar uma combinação tipo/idioma com timeout
        // Helper function to search type/language combinations with timeout
        async function fetchTMDB(type, title, language) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), TMDB_TIMEOUT);
            
            try {
                const searchUrl = `https://api.themoviedb.org/3/search/${type}?query=${encodeURIComponent(title)}&language=${language}&page=1`;
                const response = await fetch(searchUrl, {
                    headers: {
                        'Authorization': `Bearer ${tmdbToken}`,
                        'accept': 'application/json'
                    },
                    signal: controller.signal
                });
                
                if (!response.ok) return null;
                const data = await response.json();
                return { type, language, results: data?.results || [] };
            } catch (err) {
                console.warn(`⚠️ [TMDB Search] Falha/Timeout ao buscar "${title}" (${type}, ${language}): ${err.message}`);
                return null;
            } finally {
                clearTimeout(timeoutId);
            }
        }

        for (const title of suggestedTitles) {
            try {
                let bestMatch = null;
                let bestScore = 0;
                
                // Busca as 4 combinações de forma paralela (2 tipos * 2 idiomas)
                // Fetches 4 combinations in parallel (2 types * 2 languages)
                const promises = [
                    fetchTMDB('movie', title, 'en-US'),
                    fetchTMDB('movie', title, 'pt-BR'),
                    fetchTMDB('tv', title, 'en-US'),
                    fetchTMDB('tv', title, 'pt-BR')
                ];
                
                const searchResults = await Promise.all(promises);
                
                for (const result of searchResults) {
                    if (!result?.results) continue;
                    
                    for (const item of result.results.slice(0, 5)) {
                        if (processedIds.has(item.id)) continue;
                        if (!allCatalogIds.has(item.id)) continue;
                        
                        const itemTitle = (item.title || item.name || '').toLowerCase();
                        const itemOriginalTitle = (item.original_title || item.original_name || '').toLowerCase();
                        const searchTitle = title.toLowerCase();
                        
                        let score = 0;
                        if (itemTitle === searchTitle || itemOriginalTitle === searchTitle) {
                            score = 1.0;
                        } else if (itemTitle.includes(searchTitle) || searchTitle.includes(itemTitle) ||
                                 itemOriginalTitle.includes(searchTitle) || searchTitle.includes(itemOriginalTitle)) {
                            score = 0.8;
                        } else {
                            score = Math.max(
                                similarity(itemTitle, searchTitle),
                                similarity(itemOriginalTitle, searchTitle)
                            );
                        }
                        
                        if (score > bestScore && score > 0.4) {
                            bestScore = score;
                            bestMatch = {
                                ...item,
                                media_type: result.type,
                                suggested_title: title,
                                match_score: score,
                                search_language: result.language
                            };
                        }
                    }
                }
                
                if (bestMatch) {
                    foundItems.push(bestMatch);
                    processedIds.add(bestMatch.id);
                    console.log(`✅ "${title}" → ID ${bestMatch.id} (score: ${bestMatch.match_score.toFixed(2)}, lang: ${bestMatch.search_language})`);
                } else {
                    console.log(`❌ "${title}" → não encontrado no catálogo`);
                }
                
            } catch (error) {
                console.warn(`⚠️ Erro ao processar "${title}":`, error.message);
            }
            
            if (foundItems.length >= 15) break;
        }

        console.log(`📊 ${foundItems.length} títulos únicos encontrados`);

        if (foundItems.length === 0) {
            return new Response(JSON.stringify({
                error: 'Os títulos sugeridos não estão disponíveis no catálogo 😔'
            }), { status: 404, headers });
        }

        // 4. 📥 BUSCAR DETALHES COMPLETOS (PARALELIZADO COM TIMEOUT)
        console.log('📥 Buscando detalhes completos em paralelo...');
        
        const detailedPromises = foundItems.map(async (item) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);
            
            try {
                const type = item.media_type;
                const url = `https://api.themoviedb.org/3/${type}/${item.id}?language=pt-BR`;
                
                const response = await fetch(url, {
                    headers: {
                        'Authorization': `Bearer ${tmdbToken}`,
                        'accept': 'application/json'
                    },
                    signal: controller.signal
                });
                
                if (!response.ok) return null;
                const details = await response.json();
                
                const posterPath = details.poster_path 
                    ? `https://image.tmdb.org/t/p/w500${details.poster_path}`
                    : (details.backdrop_path 
                        ? `https://image.tmdb.org/t/p/w500${details.backdrop_path}`
                        : null);
                
                const backdropPath = details.backdrop_path
                    ? `https://image.tmdb.org/t/p/w1280${details.backdrop_path}`
                    : null;
                
                return {
                    id: item.id,
                    title: details.title || details.name,
                    overview: details.overview || 'Sem sinopse disponível',
                    poster_path: posterPath,
                    backdrop_path: backdropPath,
                    vote_average: details.vote_average || 0,
                    popularity: details.popularity || 0,
                    release_date: details.release_date || details.first_air_date,
                    year: (details.release_date || details.first_air_date || 'N/A').split('-')[0],
                    genres: details.genres?.map(g => g.name).join(', ') || 'Diversos',
                    type: type,
                    suggested_title: item.suggested_title,
                    match_score: item.match_score,
                    match_reason: `Sugerido pela IA: "${item.suggested_title}" (${(item.match_score * 100).toFixed(0)}% match)`
                };
            } catch (error) {
                console.warn(`⚠️ [TMDB Details] Erro ao buscar detalhes ID ${item.id}: ${error.message}`);
                return null;
            } finally {
                clearTimeout(timeoutId);
            }
        });

        const detailedResultsRaw = await Promise.all(detailedPromises);
        const detailedResults = detailedResultsRaw.filter(Boolean);
        
        detailedResults.forEach(res => {
            console.log(`✅ ${res.title} (${res.match_score.toFixed(2)})`);
        });

        console.log(`🎉 ${detailedResults.length} resultados finais`);

        if (detailedResults.length === 0) {
            return new Response(JSON.stringify({
                error: 'Erro ao buscar detalhes dos conteúdos'
            }), { status: 500, headers });
        }

        // Ordenar por relevância
        const recommendations = detailedResults
            .sort((a, b) => {
                const scoreA = a.match_score * 0.6 + (a.vote_average / 10) * 0.3 + Math.log(a.popularity + 1) * 0.1;
                const scoreB = b.match_score * 0.6 + (b.vote_average / 10) * 0.3 + Math.log(b.popularity + 1) * 0.1;
                return scoreB - scoreA;
            })
            .slice(0, 10);

        return new Response(JSON.stringify({
            success: true,
            recommendations,
            query: userQuery,
            total: recommendations.length,
            ai_suggested_titles: suggestedTitles.slice(0, 15),
            debug: {
                catalog_size: allCatalogIds.size,
                titles_suggested: suggestedTitles.length,
                titles_found: foundItems.length,
                titles_returned: recommendations.length
            }
        }), { status: 200, headers });

    } catch (error) {
        console.error('❌ Erro geral:', error);
        return new Response(JSON.stringify({
            error: 'Erro ao processar busca'
        }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
}

function similarity(s1, s2) {
    if (!s1 || !s2) return 0;
    
    s1 = s1.toLowerCase().trim();
    s2 = s2.toLowerCase().trim();
    
    if (s1 === s2) return 1.0;
    if (s1.includes(s2) || s2.includes(s1)) return 0.85;
    
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    
    if (longer.length === 0) return 1.0;
    
    const editDistance = levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(s1, s2) {
    const costs = [];
    for (let i = 0; i <= s1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2.length; j++) {
            if (i === 0) {
                costs[j] = j;
            } else if (j > 0) {
                let newValue = costs[j - 1];
                if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
                    newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                }
                costs[j - 1] = lastValue;
                lastValue = newValue;
            }
        }
        if (i > 0) costs[s2.length] = lastValue;
    }
    return costs[s2.length];
}