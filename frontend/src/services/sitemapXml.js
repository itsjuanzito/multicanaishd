// src/services/sitemapXml.js
// Renderizacao XML do sitemap: o <urlset> de um lote e o <sitemapindex> que os lista.
// Separado de sitemapService.js so por tamanho — aquele arquivo passou de 500 linhas
// coletando catalogo, e as regras do projeto pedem que nao passe.

export const supportsEnglishAlternate = () => true;

// Exportadas (e não module-private) porque quem MONTA o catálogo é o sitemapService.js.
// Quando ficaram privadas daqui, o sitemapService referenciava os dois nomes sem importar:
// `ReferenceError` silencioso, engolido pelo `.catch(() => [])` da chamada — ou seja, TODA a
// fonte TMDB (popular/top_rated/now_playing, pt e en) ficou fora do sitemap, e sem o mapa de
// nomes em inglês todas as entradas de /en/filme/* e /en/serie/* sumiram junto (o hreflang
// depende dele). Ver tests/unit/sitemap-constants.test.js.
export const TMDB_SITEMAP_PAGES = 4;
export const SITEMAP_FETCH_TIMEOUT = 7000;

export const escapeXml = (unsafe) => {
    if (!unsafe) return "";
    return unsafe.toString().replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });
};

/** Renderiza um <urlset> a partir de um lote de entradas. */
export function renderUrlset(entries, siteUrl) {
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" 
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.map(entry => {
    const ptPath = entry.path === '' ? '/' : entry.path;
    const hasEnglishAlternate = supportsEnglishAlternate(ptPath) && !entry.enUnknown;
    const enPath = entry.enPath ? `/en${entry.enPath}` : (ptPath === '/' ? '/en' : `/en${ptPath}`);
    
    const ptUrl = `${siteUrl}${ptPath}`;
    const enUrl = `${siteUrl}${enPath}`;
    // image:loc exige URL absoluta: canal sem logo vem com "/placeholder.jpg", que o Search
    // Console rejeita como "URL inválido". Sem imagem válida, a entrada sai sem <image:image>.
    const imgUrl = /^https?:\/\//i.test(entry.image || '') ? entry.image : null;

    let enTitle = entry.title;
    if (enTitle === 'Explorar Gêneros') enTitle = 'Explore Genres';
    else if (enTitle === 'MultiCanaisHD') enTitle = 'MultiCanaisHD Streaming';
    else if (entry.path.startsWith('/filme/') || entry.path.startsWith('/serie/')) {
        enTitle = `${entry.title} - Watch Online`;
    }
    
    const ptImageTag = imgUrl ? `
    <image:image>
      <image:loc>${escapeXml(imgUrl)}</image:loc>
      <image:title>${escapeXml(entry.title)}</image:title>
    </image:image>` : '';

    const enImageTag = imgUrl ? `
    <image:image>
      <image:loc>${escapeXml(imgUrl)}</image:loc>
      <image:title>${escapeXml(enTitle)}</image:title>
    </image:image>` : '';

    const ptAlternateLinks = hasEnglishAlternate ? `
    <xhtml:link rel="alternate" hreflang="pt" href="${escapeXml(ptUrl)}"/>
    <xhtml:link rel="alternate" hreflang="en" href="${escapeXml(enUrl)}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(ptUrl)}"/>` : '';

    const enAlternateLinks = hasEnglishAlternate ? `
    <xhtml:link rel="alternate" hreflang="pt" href="${escapeXml(ptUrl)}"/>
    <xhtml:link rel="alternate" hreflang="en" href="${escapeXml(enUrl)}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(ptUrl)}"/>` : '';

    const lastmodTag = entry.lastmod ? `\n    <lastmod>${entry.lastmod}</lastmod>` : '';

    const ptEntry = `  <url>
    <loc>${escapeXml(ptUrl)}</loc>${lastmodTag}
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
    ${ptAlternateLinks}${ptImageTag}
  </url>`;

    if (!hasEnglishAlternate) {
        return ptEntry;
    }

    return `${ptEntry}
  <url>
    <loc>${escapeXml(enUrl)}</loc>${lastmodTag}
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
    ${enAlternateLinks}${enImageTag}
  </url>`;
}).join('\n')}
</urlset>`;

    return sitemap.trim();
}

/** O <sitemapindex> que aponta pros lotes. */
export function renderIndex(siteUrl, total) {
    const filhos = Array.from({ length: total }, (_, i) =>
        `  <sitemap>\n    <loc>${siteUrl}/sitemap-${i + 1}.xml</loc>\n  </sitemap>`
    );
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...filhos,
        '</sitemapindex>',
    ].join('\n');
}
