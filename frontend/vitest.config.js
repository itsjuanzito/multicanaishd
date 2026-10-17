import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    env: {
      KEY_API_TMDB: 'test-api-key-mock' // Segurança exigida pelo content-lists.js
    },
    include: ['tests/unit/**/*.{test,spec}.{js,ts}', 'tests/integration/**/*.{test,spec}.{js,ts}'],
    // Configurações para lidar com as importações .astro ou caminhos absolutos, se necessário
    alias: {
      '@': '/src'
    }
  }
});
