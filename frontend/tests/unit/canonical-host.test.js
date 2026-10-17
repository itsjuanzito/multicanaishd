import { describe, it, expect, beforeEach, vi } from "vitest";

// Projeto novo: ainda não tem domínio legado — `HOSTS_LEGADOS` nasce vazio.
// O que estes testes fixam é a invariante que não pode quebrar em nenhuma
// configuração: o domínio canônico nunca redireciona para ele mesmo (loop) e
// host desconhecido não é tocado.
//
// Quando este projeto migrar de domínio, o domínio de saída entra em
// `HOSTS_LEGADOS` e os casos de "legado chega ao canônico num salto só" voltam
// a existir (ver a versão do projeto irmão).
let destinoDeMigracao, hostCanonicoConfigurado, HOSTS_LEGADOS, getSiteUrl;

async function carregarCom(siteUrl) {
    vi.resetModules();
    if (siteUrl === null) delete process.env.SITE_URL;
    else process.env.SITE_URL = siteUrl;
    ({ destinoDeMigracao, hostCanonicoConfigurado, HOSTS_LEGADOS } = await import("../../src/services/canonicalHost.js"));
    ({ getSiteUrl } = await import("../../src/services/env-adapter.js"));
}

beforeEach(() => {
    delete process.env.SITE_URL;
});

describe("host canonico", () => {
    it("nao tem dominio legado configurado", async () => {
        await carregarCom("https://multicanaishd.lol");
        expect(HOSTS_LEGADOS).toEqual([]);
    });

    it("nao redireciona o proprio canonico nem subdominio dele", async () => {
        await carregarCom("https://multicanaishd.lol");

        expect(destinoDeMigracao("multicanaishd.lol")).toBeNull();
        expect(destinoDeMigracao("www.multicanaishd.lol")).toBeNull();
        expect(destinoDeMigracao("api.multicanaishd.lol")).toBeNull();
    });

    it("nao toca em host desconhecido, localhost nem porta do dev", async () => {
        await carregarCom("https://multicanaishd.lol");

        expect(destinoDeMigracao("localhost")).toBeNull();
        expect(destinoDeMigracao("127.0.0.1")).toBeNull();
        expect(destinoDeMigracao("site-qualquer.com")).toBeNull();
        expect(destinoDeMigracao("multicanaishd.lol:4321")).toBeNull();
    });

    it("sem SITE_URL cai no padrao do env-adapter, sem loop", async () => {
        await carregarCom(null);

        // O domínio NÃO é fixado aqui de propósito: DEFAULT_SITE_URL mora só no
        // env-adapter, para uma migração não consertar um lado e esquecer o outro.
        const padrao = new URL(getSiteUrl()).hostname;
        expect(hostCanonicoConfigurado()).toBe(padrao);
        expect(destinoDeMigracao(padrao)).toBeNull();
    });

    it("SITE_URL invalida nao gera redirecionamento", async () => {
        await carregarCom("nao-e-url-valida://%%%");
        expect(destinoDeMigracao("multicanaishd.lol")).toBeNull();
    });

    it("host vazio ou indefinido nao redireciona", async () => {
        await carregarCom("https://multicanaishd.lol");

        expect(destinoDeMigracao("")).toBeNull();
        expect(destinoDeMigracao(undefined)).toBeNull();
    });
});
