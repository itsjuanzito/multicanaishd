// src/pages/components/moderacao/checkUrlsClient.js
//
// Checagem sob demanda de URLs soltas no painel /moderacao.
//
// Fica em módulo próprio porque moderacaoClient.js já passou do teto de 500 linhas do code.md
// (§3.2): a seção nova nasce fora do arquivo grande em vez de engordá-lo.
//
// O fetch é feito pelo SERVIDOR (/api/admin/check-urls) com UA de Googlebot — feito do
// navegador, o status poderia diferir do que o crawler recebe.

export const MAX_URLS_CHECAGEM = 50;

// Cor por status: verde 200, amarelo 301/302, vermelho 451, cinza o resto.
const descreverStatus = (status) => {
    if (status === 200) return { rotulo: '200 ok', classe: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };
    if (status === 301 || status === 302) return { rotulo: `${status} redirect`, classe: 'bg-amber-500/15 text-amber-300 border-amber-500/30' };
    if (status === 451) return { rotulo: '451 bloqueado', classe: 'bg-[#DF0912]/15 text-red-300 border-[#DF0912]/30' };
    if (status === 0) return { rotulo: 'sem resposta', classe: 'bg-white/[0.06] text-gray-400 border-white/10' };
    return { rotulo: String(status), classe: 'bg-white/[0.06] text-gray-400 border-white/10' };
};

const TONS_FEEDBACK = {
    info: 'bg-white/[0.03] border-white/10 text-gray-300',
    ok: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300',
    erro: 'bg-[#DF0912]/10 border-[#DF0912]/30 text-red-300',
    alerta: 'bg-amber-500/10 border-amber-500/20 text-amber-300',
};

function definirFeedback(mensagem, tipo = 'info') {
    const el = document.getElementById('check-urls-feedback');
    if (!el) return;
    if (!mensagem) {
        el.classList.add('hidden');
        return;
    }
    el.className = `p-3.5 rounded-lg border text-xs ${TONS_FEEDBACK[tipo] || TONS_FEEDBACK.info}`;
    el.innerHTML = mensagem;
    el.classList.remove('hidden');
}

function renderizarResultados(resultados, escapeHtml) {
    const listEl = document.getElementById('check-urls-list');
    if (!listEl) return;
    if (!resultados.length) {
        listEl.classList.add('hidden');
        return;
    }
    listEl.classList.remove('hidden');
    listEl.innerHTML = resultados.map((item) => {
        const { rotulo, classe } = descreverStatus(item.status);
        const detalhe = item.erro
            ? `<span class="text-[10px] text-gray-500 truncate">${escapeHtml(item.erro)}</span>`
            : '';
        const destino = item.location ? ` → ${escapeHtml(item.location)}` : '';
        return `
            <div class="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div class="min-w-0 flex-1 space-y-1">
                    <div class="flex items-center gap-2">
                        <span class="text-[10px] px-1.5 py-0.5 rounded border ${classe} font-mono">${rotulo}</span>
                        ${detalhe}
                    </div>
                    <div class="text-[11px] font-mono text-gray-400 break-all">${escapeHtml(item.url)}${destino}</div>
                </div>
                <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="text-[10px] font-medium px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] text-gray-300 hover:text-white transition-colors shrink-0 self-end sm:self-auto">Abrir</a>
            </div>
        `;
    }).join('');
}

function resumir(resultados) {
    const contar = (status) => resultados.filter((r) => r.status === status).length;
    const bloqueadas = contar(451);
    const redirecionando = contar(301) + contar(302);
    const ok = contar(200);
    definirFeedback(
        `Checadas ${resultados.length} URL(s): ${ok} com <strong>200</strong>, ` +
        `${redirecionando} redirecionando, ${bloqueadas} com <strong>451</strong>.`,
        bloqueadas > 0 ? 'alerta' : 'ok'
    );
}

function lerUrls() {
    const textarea = document.getElementById('check-urls-input');
    return (textarea?.value || '').split('\n').map((linha) => linha.trim()).filter(Boolean);
}

/**
 * Liga o botão "Checar URLs" da seção de rotação de URL.
 * @param {{obterToken: () => string, escapeHtml: (s: any) => string}} deps
 */
export function inicializarCheckUrls({ obterToken, escapeHtml }) {
    document.getElementById('check-urls-btn').onclick = () => checar(obterToken(), escapeHtml);
}

async function checar(token, escapeHtml) {
    if (!token) return;
    const spinner = document.getElementById('check-urls-spinner');
    const urls = lerUrls();

    if (urls.length === 0) {
        definirFeedback('Cole pelo menos uma URL (uma por linha) para checar.', 'alerta');
        return;
    }
    if (urls.length > MAX_URLS_CHECAGEM) {
        definirFeedback(`Envie no máximo ${MAX_URLS_CHECAGEM} URLs por checagem (vieram ${urls.length}).`, 'alerta');
        return;
    }

    spinner?.classList.remove('hidden');
    definirFeedback(`Checando ${urls.length} URL(s)...`);

    try {
        const res = await fetch(`/api/admin/check-urls?token=${encodeURIComponent(token)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, urls }),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data.success) {
            definirFeedback(`Erro: ${escapeHtml(data.error || 'falha ao checar as URLs')}`, 'erro');
            document.getElementById('check-urls-list')?.classList.add('hidden');
            return;
        }

        const resultados = data.results || [];
        renderizarResultados(resultados, escapeHtml);
        resumir(resultados);
    } catch (err) {
        console.error('[check-urls] Falha na checagem:', err);
        definirFeedback('Falha ao checar as URLs. Tente novamente.', 'erro');
    } finally {
        spinner?.classList.add('hidden');
    }
}
