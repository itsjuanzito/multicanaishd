import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1, // Retentativas em caso de pane isolada
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 30000, // 30 segundos limite padrão
  use: {
    // Aponta para o servidor Astro padrão ou porta customizada de testes
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:4399', 
    trace: 'on-first-retry',
    viewport: { width: 1280, height: 720 },
  },

  // Sem isso a suíte testava silenciosamente QUALQUER coisa que estivesse ouvindo na 4321.
  // Quando a porta está tomada por outro projeto Astro, o `astro dev` daqui sobe na 4322+,
  // a suíte continua batendo na 4321 e as falhas aparecem como seletores que "sumiram" —
  // um diagnóstico completamente enganoso. Agora o Playwright sobe o servidor certo.
  // Porta 4399 e não 4321: a 4321 é a porta padrão do `npm run dev`, e um dev server aberto
  // (ou o de outro projeto) faria o `--strictPort` falhar ou a suíte testar o app errado.
  webServer: process.env.PLAYWRIGHT_TEST_BASE_URL ? undefined : {
    command: 'npm run dev -- --port 4399 --strictPort',
    url: 'http://localhost:4399',
    reuseExistingServer: false,
    timeout: 120000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    }
    // Ignorando WebKit e Firefox focado na velocidade para o caminho crítico
  ]
});
