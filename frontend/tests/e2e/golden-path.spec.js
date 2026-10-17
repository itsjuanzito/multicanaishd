import { test, expect } from '@playwright/test';

test.describe('Golden Path E2E (Navegação Primária)', () => {

    test('Usuário consegue acessar a home, ver o Hero e clicar em um conteúdo', async ({ page, context }) => {
        // O interceptador de monetização do BaseLayout abre o smartlink numa aba nova no
        // primeiro clique. Fechamos qualquer popup na hora pra ele não roubar o foco nem
        // deixar páginas penduradas no contexto durante o teste.
        context.on('page', (popup) => popup.close().catch(() => {}));

        // 1. Acessa a raiz
        await page.goto('/');

        // 2. Verifica se o Cabeçalho Moderno subiu (garante que JS principal executou)
        await expect(page.locator('#main-header')).toBeVisible();

        // 3. Verifica o Hero Banner
        const heroSection = page.locator('#hero-slider').first();
        await expect(heroSection).toBeVisible();

        // 4. Verifica existência de link para assistir (Assistir Agora no destaque)
        const watchNowBtn = page.locator('#hero-slider a[href^="/"]').first();
        await expect(watchNowBtn).toBeVisible();

        // Pega o href para onde o botão leva
        const targetUrl = await watchNowBtn.getAttribute('href');
        expect(targetUrl).not.toBeNull();

        // 5. Clica no destaque e navega para a página de conteúdo.
        //
        // São DOIS cliques de propósito, não é flakiness: o interceptador global em
        // BaseLayout.astro implementa o ciclo de monetização do site — o 1º clique num CTA
        // (.bf-hero-btn, .bf-card, links de /filme/ e /serie/) chama preventDefault, abre o
        // smartlink e grava `bf_smart_cycle_<url>` no localStorage; só o 2º clique dentro da
        // janela de 30s deixa a navegação acontecer. Um clique só nunca sai da home, que era
        // exatamente por que este teste falhava.
        await watchNowBtn.click();
        await watchNowBtn.click();

        await page.waitForURL(`**${targetUrl}`, { timeout: 15000 });

        // Espera carregar a estrutura essencial do Player
        await expect(page.locator('#playerFrame')).toBeVisible({ timeout: 15000 });
    });

});
