
import os

file_path = r'c:\Users\User\programacao\projetos\betterflix\frontend\src\pages\[slug].astro'

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Localizar o fim do frontmatter (segunda ocorrência de ---)
count = 0
header_end = -1
for i, line in enumerate(lines):
    if line.strip() == '---':
        count += 1
        if count == 2:
            header_end = i
            break

if header_end == -1:
    print("Could not find frontmatter end")
    exit(1)

# Parte 1: Frontmatter
new_content = lines[:header_end+1]

# Parte 2: BaseLayout e Head Slot (Limpos)
# Vou procurar a última ocorrência do script BetterPlayer para garantir que não cortei nada essencial no final
script_start = -1
for i in range(len(lines)-1, -1, -1):
    if 'window.BetterPlayer = {' in lines[i]:
        script_start = i
        break

# Vamos reconstruir o meio manualmente para ser seguro
# Pegando os dados do data-layer (precisamos dos valores Astro)
# Na verdade, o melhor é pegar a estrutura que EU SEI que é a correta.

mid_section = [
    "\n",
    "<BaseLayout\n",
    "    title={pageTitle}\n",
    "    description={pageDescription}\n",
    "    image={dadosMulti.backdrop || dadosMulti.poster}\n",
    "    preloadImage={dadosMulti.backdrop}\n",
    "    type=\"video.movie\"\n",
    "    keywords={`${dadosMulti.name}, assistir ${dadosMulti.name}, ${dadosMulti.name} online, ${dadosMulti.name} dublado grátis, filmes online, séries online, assistir grátis`}\n",
    "    jsonLd={{\n",
    "        \"@context\": \"https://schema.org\",\n",
    "        \"@type\": type === \"movie\" ? \"Movie\" : \"TVSeries\",\n",
    "        name: dadosMulti.name,\n",
    "        image: dadosMulti.poster,\n",
    "        description: pageDescription,\n",
    "        datePublished: dadosMulti.date,\n",
    "        genre: dadosMulti.genres,\n",
    "        aggregateRating: {\n",
    "            \"@type\": \"AggregateRating\",\n",
    "            ratingValue: dadosMulti.vote > 0 ? String(dadosMulti.vote.toFixed(1)) : \"8.5\",\n",
    "            bestRating: \"10\",\n",
    "            ratingCount: String(dadosMulti.voteCount),\n",
    "        },\n",
    "        review: {\n",
    "            \"@type\": \"Review\",\n",
    "            \"author\": {\n",
    "                \"@type\": \"Organization\",\n",
    "                \"name\": \"BetterFlix Editorial\"\n",
    "            },\n",
    "            \"reviewRating\": {\n",
    "                \"@type\": \"Rating\",\n",
    "                \"ratingValue\": editorScore,\n",
    "                \"bestRating\": \"10\"\n",
    "            }\n",
    "        }\n",
    "    }}\n",
    ">\n",
    "    <Fragment slot=\"head\">\n",
    "        <script type=\"application/ld+json\" set:html={JSON.stringify({\n",
    "            \"@context\": \"https://schema.org\",\n",
    "            \"@type\": \"BreadcrumbList\",\n",
    "            itemListElement: [\n",
    "                { \"@type\": \"ListItem\", position: 1, name: t('nav.home'), item: Astro.url.origin },\n",
    "                { \"@type\": \"ListItem\", position: 2, name: type === \"movie\" ? t('nav.movies') : t('nav.series'), item: `${Astro.url.origin}${lang === 'pt' ? '' : '/en'}/explorar?type=${type}` },\n",
    "                { \"@type\": \"ListItem\", position: 3, name: dadosMulti.primaryGenre?.name || (type === \"movie\" ? t('nav.movies') : t('nav.series')), item: `${Astro.url.origin}${lang === 'pt' ? '' : '/en'}/genero/${dadosMulti.genreSlug}` },\n",
    "                { \"@type\": \"ListItem\", position: 4, name: dadosMulti.name, item: Astro.url.href }\n",
    "            ]\n",
    "        })} />\n",
    "    </Fragment>\n",
    "\n",
    "    <main class=\"container mx-auto px-4 py-8 xl:px-8 max-w-[1450px] mt-24 sm:mt-28\">\n",
    "        <div id=\"slug-data-layer\" hidden\n",
    "            data-id={id} data-type={type} data-slug={slug} data-genres={dadosMulti.genres} data-poster={dadosMulti.poster}\n",
    "            data-title={dadosMulti.name} data-season={season} data-episode={episode} data-user-vip={isVIP ? \"true\" : \"false\"}\n",
    "            data-initial-episodes={JSON.stringify(initialEpisodes)} data-smartlink={SMARTLINK} data-backdrop={dadosMulti.backdrop}\n",
    "            data-total-episodes={type === 'tv' ? response.number_of_episodes : 0} data-trailer-key={dadosMulti.trailerKey}\n",
    "            data-t-sync={t('player.sync_full')} data-t-season={t('player.season')} data-t-episode={t('player.episode')}\n",
    "            data-t-watched={t('player.watched')} data-t-watched-done={t('player.watched_done')} data-t-next-ep={t('player.next_ep')}\n",
    "            data-t-new={t('player.new_badge')} data-t-fetching={t('player.fetching_episodes')} data-t-error-loading={t('player.error_loading_episodes')}\n",
    "            data-t-ep-watched={t('player.ep_watched_feedback')} data-t-mark-ep-watched={t('player.mark_ep_watched_feedback')}\n",
    "            data-t-movie-watched={t('player.movie_watched')} data-t-mark-movie-watched={t('player.mark_movie_watched')}\n",
    "            data-t-watch={t('meta.watch')} data-t-online-free={t('meta.online_free')} data-t-no-synopsis={t('content.no_synopsis')}\n",
    "            data-t-removed={t('watchlist.removed_toast')} data-t-added={t('watchlist.added_toast')}\n",
    "            data-t-watchlist={t('player.my_list')} data-t-saved={t('player.list_saved')} data-lang={lang}\n",
    "        ></div>\n",
    "\n",
    "        <div class=\"flex items-center gap-2 mb-6\">\n",
    "            <a href={backUrl} class=\"p-2 bg-white/5 hover:bg-[#FF5555] rounded-full transition-all group\">\n",
    "                <svg class=\"w-5 h-5 text-gray-400 group-hover:text-white\" fill=\"none\" stroke=\"currentColor\" viewBox=\"0 0 24 24\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M15 19l-7-7 7-7\"/></svg>\n",
    "            </a>\n",
    "            <div class=\"h-4 w-px bg-white/10 mx-1\"></div>\n",
    "            <div class=\"flex items-center gap-2 text-xs font-black uppercase tracking-tighter text-gray-500\">\n",
    "                <a href={backUrl} class=\"hover:text-white transition-colors\">{t('nav.home')}</a>\n",
    "                <span>/</span>\n",
    "                <span class=\"text-white truncate max-w-[150px] sm:max-w-none\">{dadosMulti.name}</span>\n",
    "            </div>\n",
    "        </div>\n",
    "\n",
    "        <div id=\"player-main-grid\" class={type === 'movie' ? \"flex flex-col items-center mb-12\" : \"grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 mb-12\"}>\n",
    "            <div id=\"player-left-col\" class={type === 'movie' ? \"w-full max-w-6xl space-y-6\" : \"lg:col-span-8 space-y-6\"}>\n",
    "                {!isVIP && (\n",
    "                    <div class=\"bg-red-500/10 border border-red-500/20 rounded-lg overflow-hidden\">\n",
    "                        <button id=\"avisoToggle\" class=\"w-full flex items-center justify-between p-3 text-left hover:bg-red-500/20 transition-colors\">\n",
    "                            <div class=\"flex items-center gap-3\">\n",
    "                                <span class=\"flex items-center justify-center w-6 h-6 rounded-full bg-red-500 text-white text-xs font-bold\">!</span>\n",
    "                                <span class=\"text-red-200 text-sm font-medium\">{t('player.problems')}</span>\n",
    "                            </div>\n",
    "                            <svg id=\"avisoArrow\" class=\"w-4 h-4 text-red-400 transition-transform\" fill=\"none\" viewBox=\"0 0 24 24\" stroke=\"currentColor\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M19 9l-7 7-7-7\"></path></svg>\n",
    "                        </button>\n",
    "                        <div id=\"avisoContent\" class=\"max-h-0 overflow-hidden transition-all duration-300\">\n",
    "                            <div class=\"p-4 pt-0 text-red-100/80 text-sm leading-relaxed border-t border-red-500/20 mt-2\">\n",
    "                                <p>{t('player.adblock_notice')}</p>\n",
    "                            </div>\n",
    "                        </div>\n",
    "                    </div>\n",
    "                )}\n",
    "\n",
    "                <div class=\"relative w-full aspect-video bg-black rounded-xl overflow-hidden shadow-2xl shadow-black/50 border border-white/5\">\n",
    "                    <iframe id=\"playerFrame\" src=\"\" style=\"border:0\" scrolling=\"no\" frameborder=\"0\" height=\"100%\" width=\"100%\" allowfullscreen=\"true\" allow=\"autoplay *; fullscreen *; encrypted-media *; picture-in-picture *; accelerometer; gyroscope; clipboard-write\" class=\"absolute top-0 left-0 w-full h-full z-10\"></iframe>\n",
    "                    <div id=\"player-source-loader\" class=\"absolute inset-0 z-[100] flex flex-col items-center justify-center bg-[#0c0c0c] transition-opacity duration-300 pointer-events-none opacity-0\">\n",
    "                        <div class=\"w-10 h-10 border-2 border-[#FF5555] border-t-transparent rounded-full animate-spin mb-4\"></div>\n",
    "                        <p class=\"text-[10px] font-black uppercase tracking-[0.4em] text-white/50 italic animate-pulse\">{t('player.loading_link')}</p>\n",
    "                    </div>\n",
    "                </div>\n",
    "\n",
    "                <div class=\"flex flex-col gap-4 bg-[#1f1f1f] p-4 rounded-xl border border-white/5\">\n",
    "                    <div class=\"flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4\">\n",
    "                        <div class=\"flex flex-wrap items-center gap-3\">\n",
    "                            <span class=\"text-gray-400 text-xs font-bold uppercase tracking-wider\">{t('player.source')}</span>\n",
    "                            <select id=\"sourceSelector\" class=\"bg-[#2a2a2a] text-white text-sm font-bold rounded-lg pl-4 pr-10 py-2.5 border border-white/10 transition-all appearance-none cursor-pointer hover:bg-[#333] bg-no-repeat bg-[length:18px_18px] bg-[position:right_12px_center] bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23FF5555%22%20stroke-width%3D%223%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')]\">\n",
    "                                <option value=\"source1\">{t('player.source_main')}</option>\n",
    "                                <option value=\"source2\" disabled={!isVIP}>{t('player.source_premium')} {!isVIP ? ' (🔒 VIP)' : ''}</option>\n",
    "                                <option value=\"source3\">{t('player.option')} 3</option>\n",
    "                                <option value=\"source4\">{t('player.option')} 4</option>\n",
    "                            </select>\n",
    "                        </div>\n",
    "                        <div class=\"flex flex-wrap items-center gap-2\">\n",
    "                            <button id=\"favBtn\" data-id={id} data-type={type} class=\"flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2a2a2a] text-gray-300 hover:text-[#FF5555] text-xs font-bold transition-colors border border-white/5\"><svg class=\"w-4 h-4\" fill=\"none\" stroke=\"currentColor\" viewBox=\"0 0 24 24\"><path d=\"M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg><span id=\"favText\">{t('player.my_list')}</span></button>\n",
    "                            {dadosMulti.trailerKey && (<button id=\"trailerBtn\" data-key={dadosMulti.trailerKey} class=\"flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2a2a2a] text-gray-300 hover:text-white hover:bg-[#FF5555] text-xs font-bold transition-all border border-white/5\"><svg class=\"w-4 h-4 text-[#FF5555] group-hover:text-white transition-colors\" fill=\"currentColor\" viewBox=\"0 0 20 20\"><path d=\"M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z\"/></svg><span>{t('player.watch_trailer')}</span></button>)}\n",
    "                            <button id=\"cinemaModeBtn\" class=\"flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2a2a2a] text-gray-300 hover:text-yellow-400 text-xs font-bold transition-colors border border-white/5\"><svg class=\"w-4 h-4\" fill=\"none\" stroke=\"currentColor\" viewBox=\"0 0 24 24\"><path d=\"M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg><span class=\"hidden sm:inline\">{t('player.cinema_mode')}</span></button>\n",
    "                            <button id=\"embedBtn\" class=\"flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2a2a2a] text-gray-300 hover:text-[#FF5555] text-xs font-bold transition-colors border border-white/5\"><svg class=\"w-4 h-4\" fill=\"none\" stroke=\"currentColor\" viewBox=\"0 0 24 24\"><path d=\"M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg><span class=\"hidden sm:inline\">{t('player.embed')}</span></button>\n",
    "                        </div>\n",
    "                    </div>\n",
    "                    <div class=\"flex flex-wrap items-center gap-3 pt-4 border-t border-white/5\">\n",
    "                        <a href={isVIP ? \"#\" : SMARTLINK} class={`flex items-center gap-2 px-4 py-2 text-xs font-black rounded-lg border transition-all ${isVIP ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30' : 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30 hover:bg-yellow-500 hover:text-black'}`}>{isVIP ? t('player.vip_active') : t('player.no_ads')}</a>\n",
    "                    </div>\n",
    "                </div>\n",
    "\n",
    "                <div class=\"bg-[#1f1f1f] rounded-xl p-5 sm:p-7 border border-white/5 shadow-xl\">\n",
    "                    <h2 class=\"text-2xl sm:text-3xl font-black text-white mb-3\">{dadosMulti.name}</h2>\n",
    "                    <div class=\"flex flex-wrap gap-2.5 mb-5\">\n",
    "                        <span class=\"px-2.5 py-1 rounded-md bg-white/10 text-xs font-bold text-gray-200\">{ano}</span>\n",
    "                        <span class=\"px-2.5 py-1 rounded-md bg-[#FF5555]/20 text-[#FF5555] text-xs font-black border border-[#FF5555]/20\">★ {dadosMulti.vote.toFixed(1)}</span>\n",
    "                    </div>\n",
    "                    <p class=\"text-gray-300 text-sm leading-relaxed mb-6\">{dadosMulti.bio || t('content.no_synopsis')}</p>\n",
    "                    {dadosMulti.genres && (\n",
    "                        <div class=\"flex flex-wrap gap-2\">\n",
    "                            {dadosMulti.genres.split(\", \").map((g) => <span class=\"text-[11px] font-bold text-white bg-white/5 px-2.5 py-1 rounded-md border border-white/5\">{g}</span>)}\n",
    "                        </div>\n",
    "                    )}\n",
    "                </div>\n",
    "            </div>\n",
    "            {type === \"tv\" && (\n",
    "                <div class=\"lg:col-span-4 space-y-4\">\n",
    "                    <div class=\"bg-[#1f1f1f] rounded-xl flex flex-col border border-white/5 h-[700px] sticky top-24 overflow-hidden\">\n",
    "                        <div class=\"p-4 border-b border-white/5 bg-[#141414]/80\">\n",
    "                            <h3 class=\"text-white font-black mb-4 flex items-center gap-2\"><svg class=\"w-5 h-5 text-[#FF5555]\" fill=\"currentColor\" viewBox=\"0 0 24 24\"><path d=\"M4 6h16M4 10h16M4 14h16M4 18h16\" /></svg>{t('player.episodes')}</h3>\n",
    "                            <select id=\"seasonSelect\" class=\"w-full bg-[#1f1f1f] border border-white/10 text-white font-bold rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[#FF5555] transition-colors appearance-none cursor-pointer\">\n",
    "                                {dadosMulti.seasons && dadosMulti.seasons.filter(s => s.season_number > 0).map(s => (\n",
    "                                    <option value={s.season_number} selected={s.season_number.toString() === (season || \"1\")}>{t('player.season')} {s.season_number}</option>\n",
    "                                ))}\n",
    "                            </select>\n",
    "                        </div>\n",
    "                        <div id=\"episodeListContainer\" class=\"flex-1 overflow-y-auto p-3 space-y-2.5 hide-scrollbar\"></div>\n",
    "                        <div class=\"p-3 border-t border-white/5 bg-[#141414]/80\">\n",
    "                            <button id=\"markWatchedBtn\" class=\"w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-[#2a2a2a] text-gray-300 font-bold transition-all border border-white/5\">{t('player.watched')}</button>\n",
    "                        </div>\n",
    "                    </div>\n",
    "                </div>\n",
    "            )}\n",
    "        </div>\n",
    "        <div class=\"container mx-auto px-4 py-8\">\n",
    "            <LayoutCardsStreaming titleHead={t('player.recommendations')} type={type} recommendationId={id} staticData={recommendationsResponse?.results || []} lang={lang} />\n",
    "        </div>\n",
    "        <BetterComments contentId={type === \"tv\" ? `${type}_${id}_s${season || \"1\"}_e${episode || \"1\"}` : `${type}_${id}`} title={dadosMulti.name} isVIP={isVIP} />\n",
    "    </main>\n"
]

# Parte 3: Script Final
# Pegamos as linhas do script BetterPlayer até o final do arquivo
final_part = lines[script_start:]

# Combinar tudo
full_new_content = "".join(new_content) + "".join(mid_section) + "".join(final_part)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(full_new_content)

print("File restored and cleaned.")
