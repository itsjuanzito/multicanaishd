// src/pages/components/moderacao/dmcaWatchClient.js
//
// Seção "Detecção automática (451)" do painel /moderacao: liga/desliga da auto-rotação e
// tabela do log gravado pelo cron em `dmca_watch_log_v1` (KV).
//
// Fica em módulo próprio porque moderacaoClient.js já passa do teto de 500 linhas do code.md
// (§3.2) — mesmo motivo do checkUrlsClient.js.
//
// Não existe "Rodar agora": a detecção é disparada pelo cron e o endpoint interno exige o
// CRON_SECRET, que não pode ser enviado ao navegador. O botão aqui só relê o log.

const ACOES = {
    rotacionado: { rotulo: 'rotacionado', classe: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
    ignorado: { rotulo: 'ignorado', classe: 'bg-white/[0.06] text-gray-300 border-white/10' },
    erro: { rotulo: 'erro', classe: 'bg-[#DF0912]/15 text-red-300 border-[#DF0912]/30' },
    informativo: { rotulo: 'informativo', classe: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
};

// Texto humano para os motivos que o service grava (o valor cru fica no KV, para log/depuração).
const MOTIVOS = {
    slug_antigo: 'slug antigo — canônico já mudou',
    sem_canonico: 'canônico desconhecido',
    fora_de_escopo: 'fora do escopo',
    auto_rotate_desligado: 'auto-rotação desligada',
};

const TONS_FEEDBACK = {
    info: 'bg-white/[0.03] border-white/10 text-gray-300',
    ok: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300',
    erro: 'bg-[#DF0912]/10 border-[#DF0912]/30 text-red-300',
    alerta: 'bg-amber-500/10 border-amber-500/20 text-amber-300',
};

function definirFeedback(mensagem, tipo = 'info') {
    const el = document.getElementById('dmca-log-feedback');
    if (!el) return;
    if (!mensagem) {
        el.classList.add('hidden');
        return;
    }
    el.className = `p-3.5 rounded-lg border text-xs ${TONS_FEEDBACK[tipo] || TONS_FEEDBACK.info}`;
    el.innerHTML = escapeSimples(mensagem);
    el.classList.remove('hidden');
}

// O service pode devolver mensagens com HTML de escape apenas quando vieram do servidor; este
// escape local cobre os textos fixos do módulo sem depender do escapeHtml do painel.
function escapeSimples(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
}

function formatarQuando(iso) {
    if (!iso) return '—';
    try {
        const data = new Date(iso);
        if (Number.isNaN(data.getTime())) return '—';
        return data.toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch (e) {
        return '—';
    }
}

function linhaLog(entrada, escapeHtml) {
    const acao = ACOES[entrada?.acao] || ACOES.informativo;
    const motivo = entrada?.motivo && !entrada?.novoSlug
        ? `<span class="text-[10px] text-gray-500">${escapeHtml(MOTIVOS[entrada.motivo] || entrada.motivo)}</span>`
        : '';
    const slugNovo = entrada?.novoSlug
        ? `<span class="text-[11px] font-mono text-emerald-300 break-all">${escapeHtml(entrada.novoSlug)}</span>`
        : '<span class="text-[10px] text-gray-600">—</span>';

    return `<div class="grid grid-cols-1 sm:grid-cols-[130px_1fr_70px_120px_1fr] gap-1 sm:gap-3 px-4 py-3 sm:items-center">
        <span class="text-[11px] text-gray-400 font-mono">${escapeHtml(formatarQuando(entrada?.em))}</span>
        <span class="text-[11px] font-mono text-gray-300 break-all">${escapeHtml(entrada?.path || '')}</span>
        <span class="text-[11px] text-gray-400 font-mono sm:text-right">${Number(entrada?.count) || 0}</span>
        <span class="flex flex-wrap items-center gap-1.5">
            <span class="text-[10px] px-1.5 py-0.5 rounded border ${acao.classe} font-mono">${acao.rotulo}</span>
            ${motivo}
        </span>
        <span class="min-w-0">${slugNovo}</span>
    </div>`;
}

function renderizarLog(entradas, escapeHtml) {
    const lista = document.getElementById('dmca-log-list');
    const vazio = document.getElementById('dmca-log-empty');
    if (!lista) return;

    if (!entradas.length) {
        lista.classList.add('hidden');
        lista.innerHTML = '';
        vazio?.classList.remove('hidden');
        return;
    }

    vazio?.classList.add('hidden');
    lista.classList.remove('hidden');
    lista.innerHTML = entradas.map((entrada) => linhaLog(entrada, escapeHtml)).join('');
}

function aplicarEstado(dados, escapeHtml) {
    const select = document.getElementById('dmca-auto-rotate-select');
    const estado = dados?.autoRotate === 'off' ? 'off' : 'on';
    if (select) {
        select.value = estado;
        select.setAttribute('data-active-auto-rotate', estado);
    }

    // `configurado: false` = sem CLOUDFLARE_ANALYTICS_TOKEN no ambiente do deploy.
    const alerta = document.getElementById('dmca-token-alerta');
    if (alerta) alerta.classList.toggle('hidden', dados?.configurado !== false);

    renderizarLog(Array.isArray(dados?.entradas) ? dados.entradas : [], escapeHtml);
}

/** Relê o log gravado no KV. Só o servidor fala com a Analytics API. */
export async function carregarDmcaLog(token, escapeHtml = escapeSimples) {
    if (!token) return;
    const spinner = document.getElementById('dmca-refresh-spinner');
    spinner?.classList.remove('hidden');

    try {
        const res = await fetch(`/api/admin/dmca-log?token=${encodeURIComponent(token)}`);
        const dados = await res.json().catch(() => ({}));
        if (!res.ok) {
            definirFeedback(`Erro ao carregar o log: ${dados.error || 'motivo desconhecido'}`, 'erro');
            return;
        }
        aplicarEstado(dados, escapeHtml);
        if (dados.erro) definirFeedback(`Aviso: ${dados.erro}`, 'alerta');
    } catch (err) {
        console.error('[dmca-watch] Falha ao carregar o log:', err);
        definirFeedback('Falha ao carregar o log. Tente novamente.', 'erro');
    } finally {
        spinner?.classList.add('hidden');
    }
}

async function salvarAutoRotate(select, token) {
    const spinner = document.getElementById('dmca-toggle-spinner');
    const anterior = select.getAttribute('data-active-auto-rotate') || 'on';
    const proximo = select.value === 'off' ? 'off' : 'on';

    if (!token) {
        select.value = anterior;
        return;
    }

    spinner?.classList.remove('hidden');
    select.disabled = true;

    try {
        const res = await fetch('/api/admin/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, key: 'DMCA_AUTO_ROTATE', value: proximo }),
        });
        if (!res.ok) {
            const dados = await res.json().catch(() => ({}));
            throw new Error(dados.error || 'falha ao salvar');
        }
        select.setAttribute('data-active-auto-rotate', proximo);
        definirFeedback(
            proximo === 'on'
                ? 'Auto-rotação ligada. O próximo ciclo do cron já pode rotacionar obras bloqueadas.'
                : 'Auto-rotação desligada. O detector continua registrando no log, mas não move nenhum slug.',
            'ok'
        );
    } catch (err) {
        console.error('[dmca-watch] Falha ao salvar o toggle:', err);
        select.value = anterior;
        definirFeedback(`Erro ao salvar: ${err?.message || 'motivo desconhecido'}`, 'erro');
    } finally {
        spinner?.classList.add('hidden');
        select.disabled = false;
    }
}

/**
 * Liga o toggle e o botão "Recarregar log" da seção de detecção automática.
 * @param {{obterToken: () => string, escapeHtml: (s: any) => string}} deps
 */
export function inicializarDmcaWatch({ obterToken, escapeHtml }) {
    const select = document.getElementById('dmca-auto-rotate-select');
    if (!select) return;

    select.onchange = () => salvarAutoRotate(select, obterToken());
    document.getElementById('dmca-refresh-btn')?.addEventListener('click', () => {
        carregarDmcaLog(obterToken(), escapeHtml);
    });

    carregarDmcaLog(obterToken(), escapeHtml);
}
