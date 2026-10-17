import { authStore, getAuthHeaders } from "../store/authStore";
import { getAvatarPath } from "../utils/avatarPath.js";

// O texto vem de outro usuário e é injetado via innerHTML nos cards. O servidor tira < e >,
// mas confiar só nisso deixa o XSS a uma mudança de servidor de distância — e nome, nickname
// e avatar agora também vão pra marcação.
function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

let unsubAuthGlobal = null;
let lazyObserverGlobal = null;

async function initBetterComments() {
    // Mesmo motivo do unsubAuthGlobal abaixo: em navegação SPA esta função roda de novo, e
    // sem desconectar o observer da página anterior ele fica vivo observando um nó já
    // descartado, acumulando um por navegação.
    if (lazyObserverGlobal) {
        lazyObserverGlobal.disconnect();
        lazyObserverGlobal = null;
    }

    const container = document.getElementById('comments-section');
    if (!container) return;

    const contentId = container.getAttribute('data-content-id');
    if (!contentId) return;

    console.log(`[Comments] Initializing for ID: ${contentId}`);

    const t = (key) => {
        const dataEl = document.getElementById('comments-section');
        if (!dataEl) return key;
        return dataEl.getAttribute(`data-t-${key}`) || key;
    };

    const lang = container.getAttribute('data-lang') || 'pt';

    // Dynamic, robust loader for date-fns to safeguard execution
    let formatDistanceToNowFn = null;
    let dateLocale = null;
    try {
        const [dateFns, ptBRModule, enUSModule] = await Promise.all([
            import('date-fns'),
            import('date-fns/locale/pt-BR'),
            import('date-fns/locale/en-US')
        ]);
        formatDistanceToNowFn = dateFns.formatDistanceToNow;
        dateLocale = lang === 'pt' ? (ptBRModule.ptBR || ptBRModule.default || ptBRModule) : (enUSModule.enUS || enUSModule.default || enUSModule);
    } catch (e) {
        console.warn("[Comments] Could not load date-fns, falling back to built-in system formatting:", e);
    }

    const formatDate = (dateObj) => {
        if (!dateObj || isNaN(dateObj.getTime())) return "---";
        if (formatDistanceToNowFn && dateLocale) {
            try {
                return formatDistanceToNowFn(dateObj, { addSuffix: true, locale: dateLocale });
            } catch (err) {
                console.error("[Comments] formatDistanceToNow error:", err);
            }
        }
        return dateObj.toLocaleString(lang === 'pt' ? 'pt-BR' : 'en-US');
    };

    const list = document.getElementById('comments-list');
    const badge = document.getElementById('comment-count-badge');
    const form = document.getElementById('comment-form');
    let replyToId = null;

    if (unsubAuthGlobal) unsubAuthGlobal();
    unsubAuthGlobal = authStore.subscribe(({ isVIP, loading, username, nickname, avatar }) => {
        if (loading) return;
        const fc = document.getElementById('comment-form-container');
        const vc = document.getElementById('comment-vip-cta');
        if (isVIP) { fc?.classList.remove('hidden'); vc?.classList.add('hidden'); }
        else { fc?.classList.add('hidden'); vc?.classList.remove('hidden'); }

        // Espelha no formulário exatamente a identidade que o servidor vai gravar.
        const avatarEl = document.getElementById('comment-identity-avatar');
        const nameEl = document.getElementById('comment-identity-name');
        const nickEl = document.getElementById('comment-identity-nick');
        if (avatarEl) avatarEl.src = getAvatarPath(avatar);
        if (nameEl) nameEl.textContent = username || nickname || 'Membro MultiCanaisHD';
        if (nickEl) nickEl.textContent = nickname ? `@${nickname}` : '';
    });

    const render = (comments) => {
        if (!list || !badge) return;
        badge.textContent = comments.length;
        if (comments.length === 0) {
            list.innerHTML = `<div class="text-center py-20 bg-white/5 rounded-3xl border border-dashed border-white/10 w-full"><p class="text-gray-400 font-medium">${t('empty')}</p></div>`;
            return;
        }
        // Bloco de identidade do autor. Comentários antigos (anteriores à conta obrigatória)
        // não têm dono, então caem no avatar da inicial em vez de fingir uma foto de perfil.
        const authorBlock = (c, size) => {
            const big = size === 'lg';
            const box = big ? 'w-12 h-12' : 'w-9 h-9';
            const name = esc(c.user || '?');
            const avatarEl = c.isLegacy
                ? `<div class="${box} shrink-0 bg-[#DF0912]/15 rounded-full flex items-center justify-center text-[#DF0912] font-black border border-[#DF0912]/20 uppercase ${big ? '' : 'text-xs'}">${esc((c.user || '?').charAt(0))}</div>`
                : `<img src="${esc(getAvatarPath(c.avatar))}" alt="" loading="lazy" class="${box} shrink-0 rounded-full object-cover border border-white/10 bg-black/40" />`;
            return `
                <div class="flex items-center gap-3 min-w-0">
                    ${avatarEl}
                    <div class="min-w-0">
                        <div class="flex items-baseline gap-2 min-w-0 flex-wrap">
                            <h4 class="text-white font-bold ${big ? 'text-base' : 'text-sm'} truncate">${name}</h4>
                            ${c.nickname ? `<span class="text-[11px] text-[#DF0912] font-semibold truncate">@${esc(c.nickname)}</span>` : ''}
                        </div>
                        <span class="text-[11px] text-gray-500 font-medium">${esc(formatDate(new Date(c.date)))}</span>
                    </div>
                </div>`;
        };

        const parents = comments.filter(c => !c.parentId);
        const replies = comments.filter(c => c.parentId);
        list.innerHTML = parents.map(p => {
            const childs = replies.filter(r => r.parentId === p.id);
            return `
            <div class="comment-group space-y-4">
                <div class="comment-item bg-white/5 border border-white/10 rounded-2xl p-6 transition-all hover:bg-white/10 group">
                    <div class="flex items-start justify-between gap-4 mb-4">
                        ${authorBlock(p, 'lg')}
                        <button class="reply-btn shrink-0 text-[11px] font-semibold text-gray-500 hover:text-[#DF0912] transition-colors" data-id="${esc(p.id)}" data-user="${esc(p.user)}">${t('reply')}</button>
                    </div>
                    <p class="text-gray-300 font-medium pl-1 whitespace-pre-wrap break-words">${esc(p.text)}</p>
                </div>
                ${childs.length > 0 ? `<div class="replies-container pl-8 md:pl-16 space-y-4 border-l-2 border-white/5 ml-6">${childs.map(r => `
                    <div class="comment-item bg-white/[0.03] border border-white/10 rounded-2xl p-5">
                        <div class="mb-3">${authorBlock(r, 'sm')}</div>
                        <p class="text-gray-400 text-sm font-medium pl-1 whitespace-pre-wrap break-words">${esc(r.text)}</p>
                    </div>`).join('')}</div>` : ''}
            </div>`;
        }).join('');
        list.querySelectorAll('.reply-btn').forEach(btn => btn.onclick = () => {
            replyToId = btn.getAttribute('data-id');
            const user = btn.getAttribute('data-user');
            let ind = document.getElementById('reply-indicator');
            if (!ind) { ind = document.createElement('div'); ind.id = 'reply-indicator'; form.prepend(ind); }
            ind.className = "bg-[#DF0912]/10 border border-[#DF0912]/30 rounded-2xl px-6 py-3 mb-6 flex items-center justify-between";
            ind.innerHTML = `<span class="text-[#DF0912] text-xs font-black uppercase italic">${esc(t('responding').replace('{user}', user))}</span><button type="button" id="cancel-reply" class="text-gray-500 hover:text-white">✕</button>`;
            document.getElementById('cancel-reply').onclick = () => { replyToId = null; ind.remove(); };
            form.scrollIntoView({ behavior: 'smooth', block: 'center' });
            form.querySelector('[name="text"]')?.focus();
        });
    };

    // `fresh` só é usado depois do próprio usuário comentar, quando ele PRECISA ver o
    // próprio comentário na hora. No caminho normal deixamos a resposta ser cacheável na
    // borda (ver Cache-Control em api/comments.js): sem o cache-buster `_t`, visitas
    // repetidas ao mesmo título são absorvidas pela Cloudflare e nem chegam no Supabase.
    const load = async (fresh = false) => {
        try {
            const url = fresh
                ? `/api/comments?contentId=${contentId}&_t=${Date.now()}`
                : `/api/comments?contentId=${contentId}`;
            const res = await fetch(url, fresh ? { cache: 'no-store' } : undefined);
            const data = await res.json();
            if (document.getElementById('comments-section')?.getAttribute('data-content-id') === contentId) {
                render(data.comments || []);
            }
        } catch (e) { console.error("[Comments] Load Error:", e); }
    };

    if (form) {
        form.onsubmit = async (e) => {
            e.preventDefault();
            const btn = form.querySelector('#submit-btn');
            const fd = new FormData(form);
            const data = Object.fromEntries(fd.entries());
            if (replyToId) data.parentId = replyToId;
            if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
            try {
                // O autor é resolvido no servidor a partir deste token; o formulário não manda
                // mais nome nenhum, então não há o que forjar no corpo da requisição.
                const authHeaders = await getAuthHeaders();
                const res = await fetch('/api/comments', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...authHeaders },
                    body: JSON.stringify(data)
                });
                const resData = await res.json();
                if (resData.error?.includes('limit exceeded')) {
                    alert("Limite de cota atingido. Tente novamente mais tarde.");
                } else if (resData.needMigration) {
                    alert("A tabela de comentários ainda precisa da coluna user_id. Rode a migração no Supabase.");
                } else if (res.status === 401 || res.status === 403) {
                    alert(resData.error || t('send_error'));
                } else if (res.ok) {
                    form.reset(); replyToId = null;
                    document.getElementById('reply-indicator')?.remove();
                    await load(true);
                } else { alert(t('send_error')); }
            } catch (e) { alert(t('error')); }
            finally { if (btn) { btn.disabled = false; btn.style.opacity = '1'; } }
        };
    }

    // A seção de comentários fica no rodapé de uma página longa, e a maioria das visitas
    // nunca rola até lá — buscar na carga da página gastava uma requisição por pageview de
    // conteúdo pra uma lista que ninguém veria. Agora só busca quando entra em campo de
    // visão (com 400px de antecedência, então já está pronta quando aparece).
    if (typeof IntersectionObserver === 'undefined') {
        await load();
        return;
    }

    lazyObserverGlobal = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        lazyObserverGlobal?.disconnect();
        lazyObserverGlobal = null;
        load();
    }, { rootMargin: '400px 0px' });

    lazyObserverGlobal.observe(container);
}

// Troca de episódio na página de série não recarrega nada (pushState), então nenhum evento
// de navegação dispara: sem isto a seção continuava exibindo e publicando no episódio que o
// servidor renderizou. O player reaponta o data-content-id e emite este evento; reinicializar
// é seguro porque initBetterComments já desconecta o observer e a assinatura anteriores.
document.addEventListener('multicanaishd:comments-context-change', () => {
    initBetterComments();
});

// astro:page-load cobre tanto a carga inicial quanto navegações via ViewTransitions.
// Não adicione um segundo gatilho aqui: já houve DOMContentLoaded junto (dois fetches por
// pageview) e depois uma chamada direta a initBetterComments() no fim do módulo, que fazia
// exatamente o mesmo — o módulo executa no parse e o evento dispara em seguida. Era a causa
// de /api/comments ser o path nº1 da Cloudflare, com ~2x o volume de pageviews.
document.addEventListener('astro:page-load', initBetterComments);
