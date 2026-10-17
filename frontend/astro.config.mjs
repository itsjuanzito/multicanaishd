// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from "@astrojs/cloudflare";

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  prefetch: false,
  output: "server",

  // `ignore` (padrão) servia /serie/x e /serie/x/ como DUAS páginas 200, cada uma com
  // canonical apontando pra si mesma. O Google rastreia e indexa as duas como URLs
  // distintas — dobra o espaço de rastreamento do site inteiro e divide sinais entre
  // duplicatas que nunca consolidam. `never` faz o próprio Astro responder 301 de /x/
  // para /x (core/app/index.js:296-324), sem custo de SSR.
  trailingSlash: "never",

  i18n: {
    defaultLocale: 'pt',
    locales: ['pt', 'en'],
    routing: {
      prefixDefaultLocale: false,
    },
  },

  adapter: cloudflare({
    imageService: 'passthrough',
    platformProxy: {
      enabled: process.env.NODE_ENV !== 'production' && !process.env.CF_PAGES,
    },
  }),

  vite: {
    plugins: [tailwindcss()],
    build: {
      modulePreload: false
    }
  },

  // Só o fallback de build: em runtime quem manda é SITE_URL via getSiteUrl(). Estava preso
  // no .lat por duas migrações — é config estática, não acompanha a env sozinha.
  site: "https://multicanaishd.lol",
});
