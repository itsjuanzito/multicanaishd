// tests/unit/adshield.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// A lógica exata de isScriptAllowed adaptada de BaseLayout.astro para teste unitário
function isScriptAllowed(stack, ownOrigin = 'http://localhost:4321') {
    try {
        // Domínios de anúncio conhecidos / Known ad networks
        const knownAdKeywords = [
            "theoreticalassertshame", "e2e9dbeab094",
            "adsterra", "smartlink", "al5sm", "onclicks"
        ];

        const TRUSTED_DOMAINS = [
            "google", "cloudflare", "facebook", "onesignal",
            "astro", "vite", "localhost", "127.0.0.1"
        ];

        const lines = stack.split("\n");
        const callerFrames = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Pula linhas de instrumentação desta função e mocks de teste
            if (
                line.includes("Error") ||
                line.includes("isScriptAllowed") ||
                line.includes("pushState") ||
                line.includes("replaceState") ||
                line.includes("addEventListener")
            ) continue;

            callerFrames.push(line);
        }

        if (callerFrames.length === 0) {
            return true;
        }

        // O primeiro frame após filtrar a instrumentação é o chamador direto
        const directCallerLine = callerFrames[0];

        // Tenta extrair e validar a URL do chamador direto
        const urlMatch = directCallerLine.match(/(https?:\/\/[^\s"'()]+)/);
        if (urlMatch) {
            try {
                let urlStr = urlMatch[1].replace(/:\d+:\d+$/, '').replace(/:\d+$/, '');
                const frameUrl = new URL(urlStr);
                
                const isTrustedOrigin = frameUrl.origin === ownOrigin || TRUSTED_DOMAINS.some(d => frameUrl.hostname.includes(d));
                const containsAdKeyword = knownAdKeywords.some(kw => directCallerLine.includes(kw));

                if (isTrustedOrigin && !containsAdKeyword) {
                    return true;
                }
            } catch (_) {}
        }

        // --- Camada 1: Filtro rápido de palavras-chave estáticas ---
        if (knownAdKeywords.some(kw => stack.includes(kw))) {
            return false;
        }

        // Se o chamador direto for anônimo/eval ou sem URL clara,
        // analisamos o restante do stack para tomar decisão
        let hasOwnOriginFrame = false;
        let hasSuspiciousFrame = false;
        let hasAnonOrEvalFrame = false;

        for (let i = 0; i < callerFrames.length; i++) {
            const line = callerFrames[i];
            const match = line.match(/(https?:\/\/[^\s"'()]+)/);
            if (match) {
                try {
                    let urlStr = match[1].replace(/:\d+:\d+$/, '').replace(/:\d+$/, '');
                    const frameUrl = new URL(urlStr);
                    if (frameUrl.origin === ownOrigin) {
                        hasOwnOriginFrame = true;
                    } else if (!TRUSTED_DOMAINS.some(d => frameUrl.hostname.includes(d))) {
                        hasSuspiciousFrame = true;
                    }
                } catch (_) {}
            } else if (line.includes("<anonymous>") || line.includes("eval")) {
                hasAnonOrEvalFrame = true;
            }
        }

        if (!hasOwnOriginFrame && (hasAnonOrEvalFrame || hasSuspiciousFrame)) {
            return false;
        }

    } catch (e) {
        return true;
    }
    return true;
}

describe('AdShield History Interceptor (Unit Tests)', () => {
    const ownOrigin = 'http://localhost:4321';

    it('deve permitir chamadas de navegação normais do Astro (First-party)', () => {
        const stack = `Error
    at history.pushState (http://localhost:4321/src/layouts/BaseLayout.astro:186:20)
    at navigate (http://localhost:4321/node_modules/astro/dist/runtime/client/visible.js:10:45)
    at HTMLElement.click (http://localhost:4321/src/components/Card.astro:5:12)`;

        expect(isScriptAllowed(stack, ownOrigin)).toBe(true);
    });

    it('deve permitir chamadas do Astro rodando em localhost com portas customizadas', () => {
        const stack = `Error
    at history.pushState (http://localhost:4321/src/layouts/BaseLayout.astro:186:20)
    at navigate (http://localhost:4321/_astro/client.D12345.js:120:30)`;

        expect(isScriptAllowed(stack, ownOrigin)).toBe(true);
    });

    it('deve permitir navegação legítima mesmo se houver wrappers de terceiros na parte inferior da pilha (Event Bubbling)', () => {
        const stack = `Error
    at history.pushState (http://localhost:4321/src/layouts/BaseLayout.astro:186:20)
    at navigate (http://localhost:4321/_astro/client.D12345.js:120:30)
    at onclick (https://theoreticalassertshame.com/phjkqu25i:5:10)`; // Wrapper do AdScript inferior no bubbling

        expect(isScriptAllowed(stack, ownOrigin)).toBe(true);
    });

    it('deve bloquear chamadas abusivas iniciadas diretamente por scripts de anúncios conhecidos', () => {
        const stack = `Error
    at history.pushState (http://localhost:4321/src/layouts/BaseLayout.astro:186:20)
    at trapUser (https://theoreticalassertshame.com/phjkqu25i?key=123:5:45)`;

        expect(isScriptAllowed(stack, ownOrigin)).toBe(false);
    });

    it('deve bloquear chamadas com palavras-chave de redes de anúncio conhecidas na pilha', () => {
        const stack = `Error
    at history.pushState (http://localhost:4321/src/layouts/BaseLayout.astro:186:20)
    at Object.injectAdsterra [as init] (http://localhost:4321/assets/adsterra.js:4:12)`;

        expect(isScriptAllowed(stack, ownOrigin)).toBe(false);
    });

    it('deve bloquear frames anônimos ou baseados em eval se nenhuma origem do próprio site estiver no stack', () => {
        const stack = `Error
    at history.pushState (http://localhost:4321/src/layouts/BaseLayout.astro:186:20)
    at <anonymous> (eval at <anonymous> (https://untrusteddomain.com/script.js), <anonymous>:1:15)`;

        expect(isScriptAllowed(stack, ownOrigin)).toBe(false);
    });
});
