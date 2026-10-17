// src/scripts/smartlinkInterceptor.js
//
// Monetização por smartlink (direct link do provedor ativo). Vivia inline no BaseLayout, que
// passou de 885 linhas — acima do teto de 500 das regras do projeto — com este bloco sendo a
// maior fatia coesa e a única testável de forma isolada.
//
// NÃO cobre o popunder nem a social bar: aqueles dependem do ciclo de vida do astro:page-load
// e do estado de auth, e continuam no BaseLayout.
//
// O `.torrent-download-btn` também fica de fora de propósito: o TorrentModal tem o próprio
// fluxo de 2 cliques com smartlink, e interceptar aqui abriria duas abas no mesmo clique.

const SMARTLINK_FALLBACK = 'https://directyp.org/4/d332adbf8e8afebafa1f086455838320';

// Janela para o clique "real" depois que o anúncio abriu.
const JANELA_ACAO_MS = 15000;
const JANELA_LINK_MS = 30000;

// Ações de alta intenção que não são <a> — o interceptador de links não as pega.
// #searchTrigger (a lupa que só abre o painel de busca) já esteve aqui e saiu: não é intenção
// alta e, em mobile real, o window.open roubava o foco no primeiro toque e fazia a busca
// parecer travada. #seasonSelect fica fora pelo mesmo motivo (é <select> nativo) e é tratado
// no evento 'change', onde a escolha já foi feita.
const ACTION_CTAS = [
    ['search_input', '#globalSearchInput'],
    ['genre', '.genre-btn'],
    ['cast', 'button[onclick*="multicanaishd:open-cast"]'],
    ['embed', '#embedBtn'],
    ['download', '#downloadBtn'],
    ['fav', '#favBtn'],
    ['share', '#shareBtn'],
    ['episode', '#episodeListContainer > div']
];

// Telemetria fire-and-forget, separada por gatilho — só existe pra medir se cada mecanismo
// dispara de verdade em produção, nunca deve atrasar ou bloquear o window.open().
function logSmartlinkOpen(trigger) {
    try {
        const payload = JSON.stringify({ trigger, path: window.location.pathname });
        if (navigator.sendBeacon) {
            navigator.sendBeacon('/api/log-smartlink', new Blob([payload], { type: 'application/json' }));
        } else {
            fetch('/api/log-smartlink', { method: 'POST', body: payload, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {});
        }
    } catch (e) {}
}

// O smartlink ativo vem do servidor via #nuclear-config (provedor corrente).
// O literal só existe como rede de segurança se o atributo faltar.
function getActiveSmartlink() {
    const configEl = document.getElementById('nuclear-config');
    return configEl?.dataset.smartlink || SMARTLINK_FALLBACK;
}

function abrirSmartlink(trigger) {
    logSmartlinkOpen(trigger);
    window.open(getActiveSmartlink(), '_blank');
}

// Ciclo aberto = existe uma janela de tempo ainda válida gravada na chave. A janela é um
// timestamp de expiração, não um setTimeout: o timer morre junto com a página, então quem
// recarregava dentro da janela deixava a chave travada no localStorage.
// Valores legados ('0'/'1') expiram na primeira leitura, sem travar.
function isCycleOpen(key) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return false;
        const until = parseInt(raw, 10);
        if (!until || until <= Date.now()) {
            localStorage.removeItem(key);
            return false;
        }
        return true;
    } catch (err) {
        return false;
    }
}

function abrirCiclo(key, janelaMs) {
    localStorage.setItem(key, String(Date.now() + janelaMs));
}

function chaveDaAcao(target) {
    for (const [nome, seletor] of ACTION_CTAS) {
        const el = target.closest(seletor);
        if (!el) continue;
        if (nome !== 'episode') return 'bf_action_cycle_' + nome;
        const ep = el.querySelector('span.absolute.bottom-1.right-1')?.textContent || 'ep';
        return 'bf_action_cycle_episode_' + ep;
    }
    return null;
}

// Retorna true se consumiu o clique (anúncio aberto e navegação bloqueada).
function tratarAcao(e, target) {
    const actionKey = chaveDaAcao(target);
    if (!actionKey) return false;

    if (isCycleOpen(actionKey)) {
        localStorage.removeItem(actionKey);
        return false;
    }

    e.preventDefault();
    e.stopImmediatePropagation();
    abrirCiclo(actionKey, JANELA_ACAO_MS);
    abrirSmartlink('action');
    return true;
}

function ehBypass(link) {
    const linkText = link.textContent?.toLowerCase() || '';
    return link.hasAttribute('data-no-smartlink')
        || link.classList.contains('no-smartlink')
        || link.classList.contains('back-button')
        || link.getAttribute('href') === '#'
        || link.getAttribute('href')?.startsWith('javascript:')
        || linkText.includes('voltar')
        || linkText.includes('back');
}

function ehSmartlinkCta(link) {
    if (ehBypass(link)) return false;
    return link.classList.contains('bf-card')
        || link.classList.contains('bf-hero-btn')
        || link.classList.contains('bf-live-card')
        || link.classList.contains('bf-top10-card')
        || link.classList.contains('bf-tv-card')
        || link.classList.contains('bf-resume-card')
        || !!link.closest('.group\\/card')
        || /\/filme\/|\/serie\/|\/canal\//.test(link.href)
        || link.href.includes('?season='); // Garante interceptação infalível de episódios
}

function tratarLink(e, target) {
    const link = target.closest('a');
    if (!link) return;

    // Clique com tecla de comando já abre em nova aba: não é navegação a interceptar.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    if (link.getAttribute('data-is-vip') === 'true') {
        e.preventDefault();
        e.stopImmediatePropagation();
        document.dispatchEvent(new CustomEvent('multicanaishd:open-vip'));
        return;
    }

    if (!ehSmartlinkCta(link)) return;

    // 1º clique abre o smartlink e bloqueia; 2º clique reseta o ciclo e deixa navegar.
    const cycleKey = 'bf_smart_cycle_' + encodeURIComponent(link.href.split('?')[0]);
    if (isCycleOpen(cycleKey)) {
        localStorage.removeItem(cycleKey);
        return;
    }

    e.preventDefault();
    e.stopImmediatePropagation();
    abrirCiclo(cycleKey, JANELA_LINK_MS);
    abrirSmartlink('link');
}

/**
 * @param {() => { isVIP?: boolean }} getSession leitura otimista da sessão; VIP não monetiza.
 */
export function initSmartlinkInterceptor(getSession) {
    // Guard global: ViewTransitions reexecuta o script do layout a cada navegação, e sem isto
    // os listeners se empilhariam abrindo uma aba por navegação acumulada.
    if (window._bf_click_interceptor_init) return;
    window._bf_click_interceptor_init = true;

    document.addEventListener('click', (e) => {
        try {
            if (getSession().isVIP === true) return;

            const target = e.target;
            if (!target) return;

            // Botões de "remover" nunca monetizam: este listener roda na fase de captura, ou
            // seja, ANTES do stopPropagation do handler do próprio botão — sem esta saída,
            // tirar um item do "continuar assistindo" abriria anúncio em vez de remover.
            if (target.closest('.remove-from-history')) return;

            if (tratarAcao(e, target)) return;
            tratarLink(e, target);
        } catch (err) {
            console.error('❌ [Smartlink] Erro no interceptor de cliques:', err);
        }
    }, true);

    // Troca de temporada vai no 'change' e não no 'click' porque #seasonSelect é um <select>
    // nativo: no clique o picker do sistema ainda está aberto e o window.open rouba o foco da
    // aba em mobile — mesmo sintoma que tirou o #searchTrigger da lista de ações.
    document.addEventListener('change', (e) => {
        try {
            if (getSession().isVIP === true) return;
            if (!e.target?.closest?.('#seasonSelect')) return;

            // Sem preventDefault: ao contrário do fluxo de clique, a troca de temporada sempre
            // acontece — não dá pra pedir um segundo clique de um <select> sem desfazer a
            // escolha do usuário. Logo a chave aqui é só um limitador de frequência: um
            // anúncio por janela de 15s, não um por troca.
            const seasonKey = 'bf_action_cycle_season';
            if (isCycleOpen(seasonKey)) return;
            abrirCiclo(seasonKey, JANELA_ACAO_MS);

            abrirSmartlink('action');
        } catch (err) {}
    });
}
