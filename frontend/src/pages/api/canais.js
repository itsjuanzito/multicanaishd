import { fetchCanais } from '../../services/channelsService.js';

export async function GET({ request }) {
    try {
        const url = new URL(request.url);
        const offset = parseInt(url.searchParams.get('offset')) || 0;
        const category = url.searchParams.get('category') || 'all';
        const limit = 100; // Aumentei o limite para pegar mais canais

        const todosCanais = await fetchCanais();
        const canaisFiltrados = category === 'all'
            ? todosCanais
            : todosCanais.filter((canal) => canal.categoria === category);

        const canaisPaginados = canaisFiltrados.slice(offset, offset + limit);
        const hasMore = offset + limit < canaisFiltrados.length;

        console.log(`📺 API Canais: ${canaisPaginados.length} canais (offset: ${offset}, categoria: ${category})`);

        // Mapear para o formato esperado pelo frontend
        const canaisFormatados = canaisPaginados.map(canal => ({
            id: canal.id,
            name: canal.nome,
            logo: canal.imagem,
            url: canal.url,
            categoria: canal.categoria
        }));

        return new Response(JSON.stringify({
            canais: canaisFormatados,
            total: canaisFiltrados.length,
            hasMore,
            offset,
            category
        }), {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "public, max-age=300, s-maxage=600"
            }
        });

    } catch (error) {
        console.error('❌ Erro na API de canais:', error);

        return new Response(JSON.stringify({
            error: 'Erro ao carregar canais',
            canais: [],
            total: 0,
            hasMore: false
        }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
}
