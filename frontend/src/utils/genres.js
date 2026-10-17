// src/utils/genres.js

export const genres = [
    { id: 'anime', name: "Animes", slug: "anime", key: 'genre.anime' },
    { id: 28, name: "Ação", slug: "acao", type: "movie", key: 'genre.action' },
    { id: 12, name: "Aventura", slug: "aventura", type: "movie", key: 'genre.adventure' },
    { id: 16, name: "Animação", slug: "animacao", type: "movie", key: 'genre.animation' },
    { id: 35, name: "Comédia", slug: "comedia", type: "movie", key: 'genre.comedy' },
    { id: 80, name: "Crime", slug: "crime", type: "movie", key: 'genre.crime' },
    { id: 99, name: "Documentário", slug: "documentario", type: "movie", key: 'genre.documentary' },
    { id: 18, name: "Drama", slug: "drama", type: "movie", key: 'genre.drama' },
    { id: 10751, name: "Família", slug: "familia", type: "movie", key: 'genre.family' },
    { id: 14, name: "Fantasia", slug: "fantasia", type: "movie", key: 'genre.fantasy' },
    { id: 36, name: "História", slug: "historia", type: "movie", key: 'genre.history' },
    { id: 27, name: "Terror", slug: "terror", type: "movie", key: 'genre.horror' },
    { id: 10402, name: "Música", slug: "musica", type: "movie", key: 'genre.music' },
    { id: 9648, name: "Mistério", slug: "misterio", type: "movie", key: 'genre.mystery' },
    { id: 10749, name: "Romance", slug: "romance", type: "movie", key: 'genre.romance' },
    { id: 878, name: "Ficção Científica", slug: "ficcao", type: "movie", key: 'genre.scifi' },
    { id: 10770, name: "Cinema TV", slug: "cinema-tv", type: "movie", key: 'genre.tv_movie' },
    { id: 53, name: "Thriller", slug: "suspense", type: "movie", key: 'genre.thriller' },
    { id: 10752, name: "Guerra", slug: "guerra", type: "movie", key: 'genre.war' },
    { id: 37, name: "Faroeste", slug: "faroeste", type: "movie", key: 'genre.western' },
    { id: 10759, name: "Ação e Aventura", slug: "acao-e-aventura", type: "tv", key: 'genre.action_adventure' },
    { id: 10765, name: "Sci-Fi & Fantasy", slug: "sci-fi-e-fantasia", type: "tv", key: 'genre.scifi_fantasy' },
    { id: 10762, name: "Kids", slug: "kids", type: "tv", key: 'genre.kids' },
    { id: 10764, name: "Reality", slug: "reality", type: "tv", key: 'genre.reality' },
    { id: 10767, name: "Talk", slug: "talk", type: "tv", key: 'genre.talk' }
];

// Função para pegar o gênero pelo ID ou Slug
export function getGenreByIdOrSlug(val) {
    if (!val) return null;
    return genres.find(g => g.id.toString() === val.toString() || g.slug === val.toString());
}

// Manter compatibilidade com a função antiga se usada em outros lugares
export function getGenreName(id) {
    const genre = genres.find(g => g.id === parseInt(id));
    return genre ? genre.name : "Gênero";
}