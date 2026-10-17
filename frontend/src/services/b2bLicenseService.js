// src/services/b2bLicenseService.js
// Helpers de validação das licenças B2B (chaves bf_dev_*) usadas pelos players.

const LOCAL_DEV_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"];

/**
 * Um domínio é "de desenvolvimento" quando aponta pra máquina do próprio dev
 * (loopback, rede local) ou pra um túnel de teste (ngrok/locall.host).
 */
export function isLocalDevHost(hostname) {
    if (!hostname) return false;
    const host = hostname.trim().toLowerCase().split(":")[0];
    if (LOCAL_DEV_HOSTS.includes(host)) return true;
    if (host.startsWith("192.168.") || host.startsWith("10.") || host.startsWith("172.")) return true;
    return host.endsWith(".local") || host.includes(".ngrok") || host.includes(".locall.host");
}

/**
 * Libera o atalho de teste local do cliente B2B SEM depender de nenhum valor que ele
 * mesmo mande (parent_domain é query param, ou seja, forjável por qualquer um).
 *
 * A fonte da verdade aqui é o header Referer, que o NAVEGADOR preenche sozinho com a
 * página que embedou o player — o site que embeda não escolhe o que vai nele. Assim o
 * dev testando em localhost:3000 continua liberado sem cadastrar nada, mas uma chave
 * vazada num site público chega com o domínio real e não ganha o bypass.
 *
 * Sem Referer não há bypass: um embed de navegador sempre manda um.
 */
export function isLocalDevRequest(referer) {
    if (!referer) return false;
    try {
        return isLocalDevHost(new URL(referer).hostname);
    } catch {
        return false;
    }
}

/**
 * O plano `direct` (R$200) custa o dobro do `embed` (R$100). Sem esta checagem o
 * `?direct=true` valia pra qualquer chave ativa, então bastava comprar o plano barato.
 */
export function licenseAllowsDirectPlay(plan) {
    return plan === "direct";
}

/**
 * Hosts de loopback aceitos como entrada de whitelist de uma licença.
 *
 * `localhost` não tem ponto e por isso caía no filtro genérico de domínio, o que
 * tornava impossível cadastrar um cliente que só testa em dev server. Liberar por
 * chave (aqui) e não por bypass de Referer é o que mantém a whitelist valendo
 * alguma coisa: quem não tem `localhost` cadastrado continua barrado mesmo
 * forjando o header.
 */
const LOOPBACK_WHITELIST_ENTRIES = ["localhost", "127.0.0.1"];

/**
 * Um item já sanitizado é aceitável na whitelist quando é um domínio real
 * (tem ponto), um app (`app` / `app:pacote`) ou um host de loopback.
 */
export function isValidWhitelistEntry(entry) {
    if (!entry || entry.length < 3) return false;
    if (entry === "app" || entry.startsWith("app:")) return true;
    if (LOOPBACK_WHITELIST_ENTRIES.includes(entry)) return true;
    return entry.includes(".");
}
