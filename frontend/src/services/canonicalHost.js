// src/services/canonicalHost.js
// Decide se uma requisição chegou por um domínio legado e pra onde ela deve ser mandada.
//
// Existia como um `if` hardcoded no middleware (multicanaishd.lol -> multicanaishd.lol). Virou
// serviço porque a segunda migração de domínio (.lat -> .cfd) transformaria aquilo numa
// CADEIA de redirect (.click -> .lat -> .cfd) — exatamente o que o commit 95f5170 se deu ao
// trabalho de eliminar. Aqui todo domínio legado vai DIRETO pro canônico, num salto só.
//
// Ativar a próxima migração é trocar SITE_URL no painel — MAS o domínio de saída precisa ser
// acrescentado a HOSTS_LEGADOS aqui antes, senão ele continua servindo 200 como se fosse
// canônico e as duas propriedades concorrem no índice. Só a troca da env não basta.

import { getEnv, getSiteUrl } from "./env-adapter.js";

// Domínios que já foram canônicos. Acrescente o atual aqui ao migrar para um novo.
//
// ORDEM DA MIGRAÇÃO: acrescente o domínio de SAÍDA aqui e só DEPOIS troque `SITE_URL` para o
// novo no painel. Enquanto `SITE_URL` apontar para o mesmo host da lista, `destinoDeMigracao`
// devolve null (atual === alvo) e nada muda — então subir esta lista antes não redireciona
// nada, e a virada acontece no instante em que a env é trocada, sem janela de 404.
export const HOSTS_LEGADOS = [];

// Usado quando SITE_URL não está configurada. Vem do DEFAULT_SITE_URL do env-adapter pra o
// domínio não ficar escrito em dois lugares. É um host FIXO de propósito: cair no host da
// requisição (como getSiteUrl faz quando recebe a URL) criaria um loop do domínio pra ele mesmo.
function hostPadrao() {
    try {
        // Valida aqui também: getSiteUrl() lê a MESMA SITE_URL que pode estar corrompida, então
        // sem esta checagem o fallback contornava a proteção de hostCanonicoConfigurado() e
        // devolvia um host lixo como destino de 301. Host vazio faz destinoDeMigracao devolver
        // null, ou seja, nenhum redirect — degradar pra "não migra" é o lado seguro.
        const host = limparHost(new URL(getSiteUrl()).hostname);
        return pareceDominio(host) ? host : "";
    } catch {
        return "";
    }
}

// Um SITE_URL corrompido nao pode virar destino de 301: sem esta checagem, um valor
// invalido produzia um "host" qualquer e o site inteiro passaria a redirecionar pra um
// dominio que nao existe -- pior que nao migrar.
function pareceDominio(host) {
    return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(host);
}

function limparHost(host) {
    return String(host || "").toLowerCase().trim().split(":")[0];
}

/** Host canônico segundo o ambiente, com fallback fixo. */
export function hostCanonicoConfigurado() {
    const raw = getEnv("SITE_URL");
    if (!raw) return hostPadrao();
    try {
        const comProtocolo = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
        const host = limparHost(new URL(comProtocolo).hostname);
        return pareceDominio(host) ? host : hostPadrao();
    } catch {
        return hostPadrao();
    }
}

/**
 * Host de destino do 301, ou null quando não há o que redirecionar.
 * Devolve null pro próprio canônico e pros subdomínios dele — só domínio legado redireciona.
 */
export function destinoDeMigracao(host, canonico = hostCanonicoConfigurado()) {
    const atual = limparHost(host);
    const alvo = limparHost(canonico);
    if (!atual || !alvo) return null;

    if (atual === alvo || atual.endsWith(`.${alvo}`)) return null;

    const eLegado = HOSTS_LEGADOS.some((legado) => atual === legado || atual.endsWith(`.${legado}`));
    return eLegado ? alvo : null;
}
