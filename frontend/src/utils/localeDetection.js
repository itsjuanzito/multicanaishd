// src/utils/localeDetection.js
// Detecção de idioma por país (cf-ipcountry/x-vercel-ip-country), compartilhada
// entre a home e as páginas de conteúdo (filme/série) para que usuários
// estrangeiros sejam levados pra versão /en mesmo entrando direto numa página interna.

const LUSOPHONE_COUNTRIES = ['BR', 'PT', 'AO', 'MZ', 'CV', 'GW', 'ST', 'TL'];

const CRAWLER_UA_REGEX = /bot|googlebot|google-inspectiontool|googleother|crawler|spider|robot|crawling|facebookexternalhit|discordbot|twitterbot|whatsapp|telegrambot|lighthouse|pagespeed|chrome-lighthouse|pingdom|gtmetrix/i;

/**
 * Resolve o locale ativo para a requisição atual com base em cookie manual,
 * país detectado via headers de edge, e UA de crawler (nunca redireciona bots).
 */
export function detectLocale(Astro) {
    const cookieLocale = Astro.cookies.get('multicanaishd_locale')?.value;
    const isManual = Astro.cookies.get('multicanaishd_locale_manual')?.value === 'true';
    const isRewrittenEn = Astro.url.searchParams.get('lang') === 'en';

    const userAgent = Astro.request.headers.get('user-agent') || '';
    const isCrawler = CRAWLER_UA_REGEX.test(userAgent);

    // Navegação de browser SEMPRE manda `Accept: text/html,...`; cliente HTTP de script
    // (verificador de rede de anúncio, monitor de uptime, curl) manda `*/*` ou nada.
    //
    // Sem esta checagem, o redirect de idioma por país pegava esses clientes: um
    // verificador rodando fora de país lusófono pedia "/" e recebia 302 pra "/en". Como
    // esse tipo de cliente normalmente não segue redirect, ele lia um corpo vazio e
    // concluía que a página não tinha as meta tags — foi o que aconteceu com a verificação
    // de domínio do Profiton. O UA não resolvia sozinho: "Profiton/1.0" não casa com
    // nenhum termo do CRAWLER_UA_REGEX.
    //
    // A intenção do guard sempre foi "só redireciona humano" (ver os call sites); isto só
    // faz o teste de humano ser de fato confiável.
    const accept = Astro.request.headers.get('accept') || '';
    const isBrowserNavigation = accept.includes('text/html');

    const cfCountry = Astro.request.headers.get('cf-ipcountry');
    const vercelCountry = Astro.request.headers.get('x-vercel-ip-country');
    const detectedCountry = (cfCountry || vercelCountry || '').toUpperCase();

    let activeLocale = cookieLocale || 'pt';
    const shouldDetect = !isManual && !isRewrittenEn && !isCrawler && isBrowserNavigation;

    if (shouldDetect) {
        if (!detectedCountry) {
            activeLocale = 'pt';
        } else {
            activeLocale = LUSOPHONE_COUNTRIES.includes(detectedCountry) ? 'pt' : 'en';
        }
    }

    return {
        activeLocale,
        isCrawler,
        isManual,
        isRewrittenEn,
        isBrowserNavigation,
        shouldSetCookie: shouldDetect && cookieLocale !== activeLocale,
    };
}

export function applyLocaleCookie(Astro, activeLocale) {
    Astro.cookies.set('multicanaishd_locale', activeLocale, {
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
        sameSite: 'lax',
    });
}
