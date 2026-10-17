/**
 * Utilitário centralizado de slugification do MultiCanaisHD.
 * Remove acentos, caracteres especiais e normaliza hífens.
 * 
 * @param {string} text - Texto para transformar em slug
 * @returns {string} - Slug limpo
 */
export const slugify = (text) => {
    if (!text) return "";
    
    return text
        .toString()
        .toLowerCase()
        .trim()
        .normalize("NFD") // Decompõe caracteres acentuados (ex: á -> a + ´)
        .replace(/[\u0300-\u036f]/g, "") // Remove os acentos
        .replace(/\s+/g, "-") // Substitui espaços por hífens
        .replace(/[^\w\-]+/g, "") // Remove tudo que não é letra, número ou hífen
        .replace(/-+/g, "-") // Remove hífens duplicados
        .replace(/^-+|-+$/g, ""); // Remove hífens do início e do fim
};

/**
 * Slug de URL de conteúdo que NUNCA volta vazio.
 *
 * slugify() remove tudo que não é [A-Za-z0-9_-], então título totalmente em script não-latino
 * ("サザエさん", "海賊王") vira string vazia e a URL sai como "/serie/153485-". Isso criava uma
 * armadilha circular: o card linkava pra URL quebrada, o guard da página 404ava, e quem
 * chegava pela URL boa ("/serie/153485-sazae-san") era redirecionado 301 de volta pra
 * quebrada — porque o expectedSlug era calculado com slugify() cru.
 *
 * Recebe candidatos em ordem de preferência (título traduzido, título original) e cai num
 * termo estável se nenhum sobreviver. O que importa é ser determinístico: o alvo do redirect
 * canônico e o que a página espera precisam bater sempre, senão volta o loop.
 *
 * @param {...string} candidates
 * @returns {string} slug garantidamente não-vazio
 */
// Transliteração cirílico/grego -> latino. Sem isso, todo título nesses scripts slugificava
// pra vazio e caía no termo genérico "assistir", o que (a) dava a MUITOS conteúdos distintos
// o mesmo slug canônico, péssimo pra indexação, e (b) fazia o site redirecionar 301 uma URL
// boa e legível ("/serie/106587-muzhskoe-zhenskoe", que vinha das nossas próprias listas com
// título transliterado) pra uma URL pior ("/serie/106587-assistir").
//
// Só cobre scripts com romanização 1:1 barata. CJK/coreano precisariam de dicionário e ficam
// no fallback — pra esses, o nome em inglês da TMDB é quem resolve (ver canonicalSlug.js).
const TRANSLITERACAO = {
    а: "a", б: "b", в: "v", г: "g", ґ: "g", д: "d", е: "e", ё: "yo", є: "ye",
    ж: "zh", з: "z", и: "i", і: "i", ї: "yi", й: "y", к: "k", л: "l", м: "m",
    н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh",
    ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e",
    ю: "yu", я: "ya",
    α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i",
    κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x", ο: "o", π: "p", ρ: "r", σ: "s",
    ς: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o"
};

const transliterar = (text) => {
    if (!text) return "";
    return text
        .toString()
        .toLowerCase()
        .replace(/[Ѐ-ӿͰ-Ͽ]/g, (c) =>
            Object.prototype.hasOwnProperty.call(TRANSLITERACAO, c) ? TRANSLITERACAO[c] : " "
        );
};

export const contentSlug = (...candidates) => {
    for (const candidate of candidates) {
        const s = slugify(candidate);
        if (s && s !== "-") return s;
    }
    // Segunda passada: o que era ilegível pro slugify pode virar latino aqui. Roda só depois
    // de todos os candidatos falharem, pra não mudar slug de título que já era latino.
    for (const candidate of candidates) {
        const s = slugify(transliterar(candidate));
        if (s && s !== "-") return s;
    }
    return "assistir";
};
