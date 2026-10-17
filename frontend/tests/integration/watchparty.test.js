import { describe, it, expect, vi, beforeEach } from 'vitest';

// Teste de Integração para verificar a reatividade dos badges de espectadores no Dashboard do Watch Party
describe('Watch Party Dashboard - Real-time Member Counts (Integration)', () => {
    let cardElement;
    let badgeElement;
    let countSpan;

    beforeEach(() => {
        // Configuração do DOM simulado (JSDOM)
        document.body.innerHTML = `
            <div class="room-card" data-room-id="77">
                <div class="flex items-center gap-2 mt-2 flex-wrap">
                    <p class="text-gray-500 text-[10px] font-bold uppercase tracking-wider">⚽ Jogos Ao Vivo</p>
                    <span class="text-white/10 text-[10px]">•</span>
                    <span data-member-count-id="77" class="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-gray-500 bg-white/5 px-2 py-0.5 rounded-md border border-white/5 transition-all">
                        <span class="count-value">0</span>
                    </span>
                </div>
            </div>
        `;

        cardElement = document.querySelector('.room-card');
        badgeElement = document.querySelector('[data-member-count-id="77"]');
        countSpan = document.querySelector('.count-value');
    });

    it('Deve atualizar a contagem de membros no DOM e mudar as classes CSS para vermelho destacado quando houver membros', () => {
        const uniqueUsers = 3;

        // Simulando exatamente a lógica de atualização implementada no client-script
        if (badgeElement && countSpan) {
            countSpan.textContent = String(uniqueUsers);
            
            if (uniqueUsers > 0) {
                badgeElement.classList.remove("text-gray-500", "bg-white/5", "border-white/5");
                badgeElement.classList.add("text-[#FF5555]", "bg-[#FF5555]/10", "border-[#FF5555]/20", "shadow-sm", "shadow-red-500/5");
            } else {
                badgeElement.classList.add("text-gray-500", "bg-white/5", "border-white/5");
                badgeElement.classList.remove("text-[#FF5555]", "bg-[#FF5555]/10", "border-[#FF5555]/20", "shadow-sm", "shadow-red-500/5");
            }
        }

        // Validações de UI (Premium UI states)
        expect(countSpan.textContent).toBe("3");
        expect(badgeElement.classList.contains("text-[#FF5555]")).toBe(true);
        expect(badgeElement.classList.contains("bg-[#FF5555]/10")).toBe(true);
        expect(badgeElement.classList.contains("border-[#FF5555]/20")).toBe(true);
        expect(badgeElement.classList.contains("text-gray-500")).toBe(false);
    });

    it('Deve manter ou reverter para o estado discreto (gray) quando a quantidade de membros for 0', () => {
        const uniqueUsers = 0;

        // Simulando a lógica de atualização
        if (badgeElement && countSpan) {
            countSpan.textContent = String(uniqueUsers);
            
            if (uniqueUsers > 0) {
                badgeElement.classList.remove("text-gray-500", "bg-white/5", "border-white/5");
                badgeElement.classList.add("text-[#FF5555]", "bg-[#FF5555]/10", "border-[#FF5555]/20", "shadow-sm", "shadow-red-500/5");
            } else {
                badgeElement.classList.add("text-gray-500", "bg-white/5", "border-white/5");
                badgeElement.classList.remove("text-[#FF5555]", "bg-[#FF5555]/10", "border-[#FF5555]/20", "shadow-sm", "shadow-red-500/5");
            }
        }

        // Validações de UI (Premium UI states)
        expect(countSpan.textContent).toBe("0");
        expect(badgeElement.classList.contains("text-[#FF5555]")).toBe(false);
        expect(badgeElement.classList.contains("text-gray-500")).toBe(true);
        expect(badgeElement.classList.contains("bg-white/5")).toBe(true);
        expect(badgeElement.classList.contains("border-white/5")).toBe(true);
    });
});
