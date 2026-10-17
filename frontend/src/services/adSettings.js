// src/services/adSettings.js
//
// Dados puros de monetização — sem env, sem KV, sem Supabase. Existe separado do
// configService.js justamente por isso: o painel de moderação roda no NAVEGADOR e não
// consegue importar o configService (que puxa env-adapter). Antes disso o
// moderacaoClient.js mantinha uma cópia manual desta tabela "em sincronia manual", que
// saiu de sincronia: ficou com os links da AdMaven do domínio antigo (publisher 1463361)
// enquanto o servidor já servia os do novo (1564857). Resultado: trocar de provedor no
// painel injetava o ID velho até o próximo reload. Fonte única resolve de vez.

export const AD_SETTINGS = {
    profiton: {
        smartlink: 'https://lt.wetterdefames.com/i1XgtscRhGII/158241',
        // O popunder do ProfitOn já traz a zona embutida na própria URL (`/<id>/<zona>`), por
        // isso popunderZone fica vazio — igual ao AdMaven, e diferente da Monetag, que usa
        // tag.min.js + data-zone separado.
        popunderScript: '//zo.canopicdrowns.com/rMBYyAY6paoj4jn/158240',
        popunderZone: ''
    },
    adsterra: {
        smartlink: 'https://directyp.org/4/ff50a9f8ba369caef7154ea27e709cfa',
        popunderScript: 'https://aarems.org/1/f6a78099ede6a674f2b00836f9558c9a',
        popunderZone: ''
    },
    monetag: {
        smartlink: 'https://uplcm.com/4/12027676',
        popunderScript: 'https://al5sm.com/tag.min.js',
        popunderZone: '12027674'
    },
    admaven: {
        smartlink: 'https://nthefeetofthea.org/?sdRo2=1564857',
        popunderScript: '//d2pf0ys5xus6n.cloudfront.net/?syfpd=1564857',
        popunderZone: ''
    }
};

/**
 * Formatos persistentes da Monetag, carregados em TODAS as páginas pelo BaseLayout (fora
 * para VIP). São ORTOGONAIS ao AD_PROVIDER de propósito: rodam junto com qualquer provedor
 * ativo de popunder/direct link, por isso não moram dentro de AD_SETTINGS.
 *
 * public/sw.js agora so se auto-desregistra (kill do push antigo).
 * `zone` vira data-zone no script; o push leva a zona na query string, não no atributo.
 */
// VAZIO de proposito: push/in-page push/vignette da Monetag exibiam criativos
// 'Download is ready / Tap to proceed' e o Google marcou o dominio como 'Paginas enganosas'
// (Search Console > Problemas de seguranca, 16/10/2026). Nao reativar sem revisao dos criativos.
export const PERSISTENT_ADS = [
    // Social bar da Adsterra. Push/in-page push/vignette da Monetag seguem fora.
    { key: 'social-bar', zone: null, src: 'https://bancadeltempoidea.org/14/f68d9dfcf12b41ebe131d07c7165d335' },
];

/** Banner display da Adsterra: 728x90 no desktop, 320x50 no mobile (ver BannerAd.astro). */
export const BANNER_AD = {
    key: 'bafdf01fff5c5b10ae85b65ea30a1850',
    scriptSrc: 'https://bancadeltempoidea.org/22/bafdf01fff5c5b10ae85b65ea30a1850',
    width: 728,
    height: 90
};

export const BANNER_AD_MOBILE = {
    key: 'd5ea4a99ac507bf770c148a3acbb4e84',
    scriptSrc: 'https://bancadeltempoidea.org/22/d5ea4a99ac507bf770c148a3acbb4e84',
    width: 320,
    height: 50
};

export const AD_PROVIDERS = Object.keys(AD_SETTINGS);

/**
 * Trechos de host dos service workers que os provedores de anúncio registram na nossa
 * origem. O kill switch do PWA no BaseLayout desregistra todo SW do site EXCETO estes —
 * sem essa exceção ele matava push/popunder de todos os provedores a cada page load.
 *
 * `canopicdrowns` entrou junto com o ProfitOn: o script de popunder dele
 * (zo.canopicdrowns.com) registra SW na nossa origem igual ao tag.min.js da Monetag. Sem
 * estar aqui, o kill switch do PWA desregistraria o SW dele a cada navegação.
 */
export const AD_SW_HOSTS = ['aarems', 'bancadeltempoidea', 'al5sm', 'd2pf0ys5xus6n', 'canopicdrowns'];

const PROVEDOR_PADRAO = 'adsterra';

export function normalizeAdProvider(provider) {
    const normalized = String(provider || '').trim().toLowerCase();
    return AD_PROVIDERS.includes(normalized) ? normalized : PROVEDOR_PADRAO;
}

export function getAdSettings(provider = null, fallbackProvider = PROVEDOR_PADRAO) {
    const normalizedProvider = normalizeAdProvider(provider || fallbackProvider);
    return {
        provider: normalizedProvider,
        ...AD_SETTINGS[normalizedProvider]
    };
}
