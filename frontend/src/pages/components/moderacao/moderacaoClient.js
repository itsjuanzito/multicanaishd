import { authStore, initAuth } from "../../../store/authStore";
// Fonte única dos provedores — dados puros, sem env/KV, então importa no cliente numa boa.
import { AD_SETTINGS } from "../../../services/adSettings.js";
// Checagem sob demanda de URLs soltas — módulo à parte (moderacaoClient.js já passa do teto
// de 500 linhas do code.md §3.2).
import { inicializarCheckUrls } from "./checkUrlsClient.js";
// Detecção automática de bloqueio legal (451) — módulo próprio, pelo mesmo motivo.
import { inicializarDmcaWatch, carregarDmcaLog } from "./dmcaWatchClient.js";

    function updateAdsToggleBtn(provider) {
        const select = document.getElementById('ads-provider-select');
        if (!select) return;
        select.setAttribute('data-active-provider', provider);
        select.value = provider;
    }

    function syncCurrentAdConfig(provider) {
        const configLayer = document.getElementById('nuclear-config');
        if (!configLayer) return;

        const settings = AD_SETTINGS[provider] || AD_SETTINGS.adsterra;
        configLayer.dataset.adProvider = provider;
        configLayer.dataset.smartlink = settings.smartlink;
        configLayer.dataset.popunderScript = settings.popunderScript;
        configLayer.dataset.popunderZone = settings.popunderZone;
    }

    async function handleAdsProviderChange(e) {
        const select = e.target;
        const nextProvider = select.value;
        const token = localStorage.getItem('bf_mod_token') || '';
        if (!token) return;

        const spinner = document.getElementById('toggle-ads-spinner');
        if (spinner) spinner.classList.remove('hidden');
        select.disabled = true;

        try {
            const res = await fetch('/api/admin/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, key: 'AD_PROVIDER', value: nextProvider })
            });

            if (res.ok) {
                updateAdsToggleBtn(nextProvider);
                syncCurrentAdConfig(nextProvider);
            } else {
                const data = await res.json().catch(() => ({}));
                alert(`Erro ao trocar provedor de anúncios: ${data.error || 'motivo desconhecido'}`);
                updateAdsToggleBtn(select.getAttribute('data-active-provider') || 'adsterra');
            }
        } catch (err) {
            console.error("Error changing ads provider:", err);
            alert("Falha de rede ao trocar provedor de anúncios.");
            updateAdsToggleBtn(select.getAttribute('data-active-provider') || 'adsterra');
        } finally {
            if (spinner) spinner.classList.add('hidden');
            select.disabled = false;
        }
    }

    async function handleModGlobalClicks(e) {
        // 1.5. Reset Ranking
        const resetRankingBtn = e.target.closest('#reset-ranking-btn');
        if (resetRankingBtn) {
            const token = localStorage.getItem('bf_mod_token') || '';
            if (!token) return;

            if (!confirm("TEM CERTEZA? Essa ação vai resetar as horas de TODOS os usuários do Ranking. As horas do perfil não serão afetadas.")) return;

            const spinner = document.getElementById('reset-ranking-spinner');
            if (spinner) spinner.classList.remove('hidden');
            resetRankingBtn.disabled = true;

            try {
                const res = await fetch('/api/admin/reset-ranking', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token })
                });

                if (res.ok) {
                    alert("✅ Temporada do ranking resetada com sucesso! As horas de competição foram zeradas.");
                } else {
                    const data = await res.json();
                    alert("Erro ao resetar: " + (data.error || "Desconhecido"));
                }
            } catch (err) {
                console.error(err);
                alert("Falha na comunicação com o servidor.");
            } finally {
                if (spinner) spinner.classList.add('hidden');
                resetRankingBtn.disabled = false;
            }
            return;
        }

        // 2. Salvar configuração geral
        const saveConfigBtn = e.target.closest('.save-config-btn');
        if (saveConfigBtn) {
            const token = localStorage.getItem('bf_mod_token') || '';
            if (!token) return;

            const container = saveConfigBtn.parentElement;
            const input = container?.querySelector('.config-input');
            if (!input) return;

            const key = input.getAttribute('data-config-key');
            const value = input.value;

            saveConfigBtn.disabled = true;
            const originalHtml = saveConfigBtn.innerHTML;
            saveConfigBtn.innerHTML = '<div class="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full mx-auto"></div>';

            try {
                const res = await fetch('/api/admin/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token, key, value })
                });

                if (res.ok) {
                    saveConfigBtn.classList.add('bg-emerald-500');
                    saveConfigBtn.classList.remove('bg-white/5');
                    setTimeout(() => {
                        saveConfigBtn.classList.remove('bg-emerald-500');
                        saveConfigBtn.classList.add('bg-white/5');
                    }, 2000);
                } else {
                    const data = await res.json().catch(() => ({}));
                    alert(`Erro ao salvar configuração: ${data.error || 'motivo desconhecido'}`);
                }
            } catch (err) {
                console.error("Error saving config:", err);
                alert("Falha de rede ao salvar configuração.");
            }

            saveConfigBtn.disabled = false;
            saveConfigBtn.innerHTML = originalHtml;
            return;
        }
    }

    function initModeracao() {
        const authSection = document.getElementById('auth-section');
        const dashboardContent = document.getElementById('dashboard-content');
        const tabsContainer = document.getElementById('tabs-container');
        const tokenInput = document.getElementById('mod-token');
        const loginBtn = document.getElementById('login-btn');
        const errorMsg = document.getElementById('error-msg');

        if (!loginBtn) return;

        let currentModToken = localStorage.getItem('bf_mod_token') || '';
        let monitoringInterval = null;

        async function login(rawToken) {
            const token = rawToken?.trim();
            if (!token) return;
            
            try {
                const res = await fetch(`/api/comments?moderation=true&token=${encodeURIComponent(token)}`);
                if (res.ok) {
                    localStorage.setItem('bf_mod_token', token);
                    currentModToken = token;
                    errorMsg?.classList.add('hidden');
                    
                    // Inject dashboard HTML from template
                    const template = document.getElementById('dashboard-template');
                    if (template && dashboardContent) {
                        dashboardContent.innerHTML = '';
                        dashboardContent.appendChild(template.content.cloneNode(true));
                    }
                    
                    authSection?.classList.add('hidden');
                    dashboardContent?.classList.remove('hidden');
                    tabsContainer?.classList.remove('hidden');
                    
                    bindDashboardElements();
                    fetchComments();
                } else {
                    errorMsg?.classList.remove('hidden');
                    localStorage.removeItem('bf_mod_token');
                    authSection?.classList.remove('hidden');
                    dashboardContent?.classList.add('hidden');
                    tabsContainer?.classList.add('hidden');
                }
            } catch (e) {
                console.error("Login error:", e);
                errorMsg?.classList.remove('hidden');
            }
        }

        function bindDashboardElements() {
            // Re-get references to elements that were just injected
            const refreshBtn = document.getElementById('refresh-comments-btn');
            const searchInput = document.getElementById('user-search-query');
            const searchBtn = document.getElementById('search-user-btn');

            const refreshMonitoringBtn = document.getElementById('refresh-monitoring-btn');

            if (refreshBtn) refreshBtn.onclick = fetchComments;
            if (refreshMonitoringBtn) refreshMonitoringBtn.onclick = () => fetchMonitoringStats(true);
            if (searchInput) searchInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); searchUsers(); } };
            if (searchBtn) searchBtn.onclick = searchUsers;
            
            const refreshVipsBtn = document.getElementById('refresh-vips-list-btn');
            if (refreshVipsBtn) refreshVipsBtn.onclick = fetchActiveVipsList;

            document.getElementById('ads-provider-select')?.addEventListener('change', handleAdsProviderChange);

            document.getElementById('vip-plan-filter')?.addEventListener('change', () => {
                if (window._allVipsCache) {
                    renderActiveVipsList(window._allVipsCache);
                }
            });
            
            // Bind channel filters
            document.getElementById('channel-search')?.addEventListener('input', () => { 
                if (window._allChannelsCache) renderChannels(window._allChannelsCache, window._vipIdsCache); 
            });
            document.getElementById('channel-category-filter')?.addEventListener('change', () => { 
                if (window._allChannelsCache) renderChannels(window._allChannelsCache, window._vipIdsCache); 
            });
            document.getElementById('refresh-channels-btn')?.addEventListener('click', fetchChannels);

            // Bind Anti-DMCA URL Rotation elements
            bindUrlRotationElements();

            // Bind Send Notification form
            const notifForm = document.getElementById('send-notification-form');
            if (notifForm) {
                notifForm.onsubmit = async (e) => {
                    e.preventDefault();

                    const titleInput = document.getElementById('notif-title-input');
                    const messageInput = document.getElementById('notif-message-input');
                    const linkInput = document.getElementById('notif-link-input');
                    const feedback = document.getElementById('notif-send-feedback');
                    const btn = document.getElementById('send-notification-btn');
                    const spinner = document.getElementById('notif-send-spinner');

                    const title = titleInput?.value?.trim();
                    const message = messageInput?.value?.trim();
                    const link = linkInput?.value?.trim();
                    if (!title || !message) return;

                    if (btn) btn.disabled = true;
                    if (spinner) spinner.classList.remove('hidden');
                    if (feedback) {
                        feedback.classList.add('hidden');
                        feedback.innerHTML = '';
                    }

                    try {
                        const res = await fetch(`/api/admin/send-notification?token=${encodeURIComponent(currentModToken)}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ title, message, link: link || undefined })
                        });

                        const data = await res.json();

                        if (feedback) {
                            feedback.classList.remove('hidden');
                            if (res.ok) {
                                feedback.className = "mt-4 p-4 rounded-xl border text-xs font-bold bg-emerald-500/10 border-emerald-500/20 text-emerald-400";
                                feedback.innerHTML = `✨ Notificação enviada com sucesso para todos os usuários!`;
                                notifForm.reset();
                                fetchNotificationsList();
                            } else {
                                feedback.className = "mt-4 p-4 rounded-xl border text-xs font-bold bg-[#DF0912]/10 border-[#DF0912]/20 text-[#DF0912]";
                                feedback.innerHTML = `⚠️ Erro ao enviar: ${data.error || 'Erro desconhecido'}`;
                            }
                        }
                    } catch (err) {
                        if (feedback) {
                            feedback.classList.remove('hidden');
                            feedback.className = "mt-4 p-4 rounded-xl border text-xs font-bold bg-[#DF0912]/10 border-[#DF0912]/20 text-[#DF0912]";
                            feedback.innerHTML = `❌ Falha na conexão com o servidor: ${err.message}`;
                        }
                    } finally {
                        if (btn) btn.disabled = false;
                        if (spinner) spinner.classList.add('hidden');
                    }
                };
            }
        }

        if (currentModToken) {
            login(currentModToken);
        }

        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.onclick = () => {
                const tab = btn.getAttribute('data-tab');
                // Mantido em sincronia com navItemBase/navItemInactive/navItemActive em moderacao.astro
                const baseTabClass = "tab-btn w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-colors";
                const inactiveTabClass = `${baseTabClass} text-gray-400 hover:bg-white/[0.06] hover:text-white`;
                const activeTabClass = `${baseTabClass} bg-[#DF0912] text-white`;
                document.querySelectorAll('.tab-btn').forEach(b => {
                    b.className = inactiveTabClass;
                });
                btn.className = activeTabClass;
                
                const cs = document.getElementById('comments-section');
                const us = document.getElementById('users-section');
                const ss = document.getElementById('stats-section');
                const cfs = document.getElementById('config-section');
                const urlrots = document.getElementById('url-rotation-section');
                const si = document.getElementById('user-search-query');
                
                if (cs) cs.classList.toggle('hidden', tab !== 'comments');
                if (us) {
                    us.classList.toggle('hidden', tab !== 'users');
                    if (tab === 'users') {
                        fetchActiveVipsList();
                        setTimeout(() => si?.focus(), 100);
                    }
                }
                const chs = document.getElementById('channels-section');
                if (chs) {
                    chs.classList.toggle('hidden', tab !== 'channels');
                    if (tab === 'channels') fetchChannels();
                }
                if (urlrots) {
                    urlrots.classList.toggle('hidden', tab !== 'url-rotation');
                    if (tab === 'url-rotation') {
                        fetchUrlRotations();
                        // Relê o log do detector de 451 ao abrir a aba: ele muda sozinho a
                        // cada ciclo do cron, então a leitura do login já pode estar velha.
                        carregarDmcaLog(currentModToken, escapeHtml);
                    }
                }
                if (ss) {
                    ss.classList.toggle('hidden', tab !== 'stats');
                    if (tab === 'stats') fetchStats();
                }
                if (cfs) {
                    cfs.classList.toggle('hidden', tab !== 'config');
                    if (tab === 'config') fetchConfigs();
                }
                const nots = document.getElementById('notifications-section');
                if (nots) {
                    nots.classList.toggle('hidden', tab !== 'notifications');
                    if (tab === 'notifications') fetchNotificationsList();
                }
                const mons = document.getElementById('monitoring-section');
                if (mons) {
                    mons.classList.toggle('hidden', tab !== 'monitoring');
                    if (tab === 'monitoring') {
                        fetchMonitoringStats();
                        if (monitoringInterval) clearInterval(monitoringInterval);
                        monitoringInterval = setInterval(fetchMonitoringStats, 25000);
                    } else if (monitoringInterval) {
                        clearInterval(monitoringInterval);
                        monitoringInterval = null;
                    }
                }
                if (tab === 'comments') fetchComments();
            };
        });

        const escapeHtml = (str) => String(str || '').replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));

        async function fetchNotificationsList() {
            const list = document.getElementById('notif-list');
            if (!list) return;
            list.innerHTML = `<p class="text-gray-500 text-xs font-bold">Carregando...</p>`;

            try {
                const res = await fetch('/api/notifications');
                const data = await res.json();
                const items = data?.notifications || [];

                if (items.length === 0) {
                    list.innerHTML = `<p class="text-gray-500 text-xs font-bold">Nenhuma notificação enviada ainda.</p>`;
                    return;
                }

                list.innerHTML = items.map(n => `
                    <div class="flex items-start justify-between gap-4 bg-[#060911] border border-white/5 rounded-2xl p-4">
                        <div class="min-w-0">
                            <p class="text-sm font-bold text-white">${escapeHtml(n.title)}</p>
                            <p class="text-xs text-gray-400 mt-1">${escapeHtml(n.message)}</p>
                            <p class="text-[10px] text-gray-600 mt-2 uppercase tracking-wider">${new Date(n.created_at).toLocaleString('pt-BR')}</p>
                        </div>
                        <button type="button" data-notif-delete-id="${n.id}" class="notif-delete-btn shrink-0 w-8 h-8 flex items-center justify-center rounded-xl bg-[#DF0912]/10 hover:bg-[#DF0912]/20 text-[#DF0912] transition-all">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    </div>
                `).join('');

                list.querySelectorAll('.notif-delete-btn').forEach(btn => {
                    btn.onclick = async () => {
                        const id = btn.getAttribute('data-notif-delete-id');
                        if (!id || !confirm('Apagar esta notificação para todos os usuários?')) return;
                        btn.disabled = true;
                        try {
                            const res = await fetch(`/api/admin/send-notification?token=${encodeURIComponent(currentModToken)}&id=${encodeURIComponent(id)}`, {
                                method: 'DELETE'
                            });
                            if (res.ok) {
                                fetchNotificationsList();
                            } else {
                                const data = await res.json();
                                alert(`Erro ao apagar: ${data.error || 'Erro desconhecido'}`);
                                btn.disabled = false;
                            }
                        } catch (err) {
                            alert(`Falha na conexão: ${err.message}`);
                            btn.disabled = false;
                        }
                    };
                });
            } catch (err) {
                list.innerHTML = `<p class="text-[#DF0912] text-xs font-bold">Erro ao carregar notificações: ${err.message}</p>`;
            }
        }

        async function fetchConfigs() {
            if (!currentModToken) return;
            const loader = document.getElementById('config-loader');
            loader?.classList.remove('hidden');
            
            try {
                const res = await fetch(`/api/admin/config?token=${encodeURIComponent(currentModToken)}`);
                const data = await res.json();
                
                if (data.configs) {
                    Object.keys(data.configs).forEach(key => {
                        const input = document.querySelector(`[data-config-key="${key}"]`);
                        if (input) input.value = data.configs[key];
                    });

                    const adProvider = data.configs['AD_PROVIDER'] || 'adsterra';
                    updateAdsToggleBtn(adProvider);
                }
            } catch (e) { console.error("Error fetching configs:", e); }
            loader?.classList.add('hidden');
        }

        document.removeEventListener('click', handleModGlobalClicks);
        document.addEventListener('click', handleModGlobalClicks);

        async function fetchComments() {
            if (!currentModToken) return;
            
            let formatDistanceToNowFn = null;
            let ptBRLocale = null;

            try {
                const dateFns = await import('date-fns');
                const dateFnsLocale = await import('date-fns/locale/pt-BR');
                formatDistanceToNowFn = dateFns.formatDistanceToNow;
                ptBRLocale = dateFnsLocale.ptBR || dateFnsLocale.default || dateFnsLocale;
            } catch (importError) {
                console.warn("[Moderation] Failed to dynamically load date-fns, using fallback formatter:", importError);
            }

            const loader = document.getElementById('loading-spinner');
            const feed = document.getElementById('comments-feed');
            if (!feed) return;

            loader?.classList.remove('hidden');
            try {
                const res = await fetch(`/api/comments?moderation=true&token=${encodeURIComponent(currentModToken)}`);
                if (res.status === 401) {
                    logout();
                    return;
                }
                const data = await res.json();
                const comments = data.comments || [];
                
                feed.innerHTML = comments.length === 0 
                    ? '<div class="min-h-[220px] rounded-xl border border-dashed border-white/10 bg-white/[0.02] flex flex-col items-center justify-center text-center px-6"><div class="w-11 h-11 rounded-lg bg-white/[0.03] border border-white/10 flex items-center justify-center text-gray-500 mb-3"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h8M8 14h5m7-2a8 8 0 11-16 0 8 8 0 0116 0z"/></svg></div><p class="text-white text-sm font-semibold">Nenhum comentário pendente</p><p class="text-gray-500 text-xs mt-1">O feed de moderação está limpo.</p></div>'
                    : comments.map(c => {
                        let dateStr = '';
                        try {
                            if (formatDistanceToNowFn && ptBRLocale) {
                                dateStr = formatDistanceToNowFn(new Date(c.date), { addSuffix: true, locale: ptBRLocale });
                            } else {
                                dateStr = new Date(c.date).toLocaleString('pt-BR');
                            }
                        } catch (dateError) {
                            dateStr = c.date || 'Data desconhecida';
                        }

                        return `
                        <div class="bg-[#141414] border border-white/10 rounded-xl p-4 relative group hover:border-white/20 transition-colors">
                            <div class="flex items-start justify-between gap-3 mb-3">
                                <div class="flex items-center gap-3">
                                    <div class="w-9 h-9 bg-[#DF0912]/10 text-[#DF0912] rounded-lg flex items-center justify-center font-semibold text-sm border border-[#DF0912]/20 shrink-0">${c.user.charAt(0).toUpperCase()}</div>
                                    <div>
                                        <p class="text-white text-sm font-medium">${c.user}</p>
                                        <p class="text-xs text-gray-500 mt-0.5">${dateStr}</p>
                                    </div>
                                </div>
                                <div class="flex items-center gap-2">
                                    <a href="${c.pageUrl || '#'}" target="_blank" class="p-2 text-gray-400 hover:text-white transition-colors bg-white/[0.04] rounded-lg border border-white/10 hover:bg-white/[0.08]"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg></a>
                                    <button class="delete-btn p-2 text-[#DF0912] hover:text-white transition-colors bg-[#DF0912]/10 hover:bg-[#DF0912] border border-[#DF0912]/20 rounded-lg" data-id="${c.id}" data-content="${c.contentId}"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
                                </div>
                            </div>
                            <div class="bg-[#060911] p-4 rounded-lg border border-white/5">
                                <p class="text-gray-300 text-sm leading-relaxed">${c.text}</p>
                            </div>
                        </div>
                        `;
                    }).join('');

                document.querySelectorAll('.delete-btn').forEach(b => {
                    b.onclick = async () => {
                        if (!confirm("⚠️ APAGAR COMENTÁRIO?")) return;
                        const res = await fetch('/api/comments', { 
                            method: 'DELETE', 
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ commentId: b.getAttribute('data-id'), contentId: b.getAttribute('data-content'), token: currentModToken }) 
                        });
                        if (res.ok) fetchComments();
                    };
                });
            } catch (e) { 
                console.error("Error fetching comments:", e);
            } finally { 
                loader?.classList.add('hidden'); 
            }
        }

        // Tier vem do prefixo do rótulo do último pagamento; sem prefixo = Básico.
        function describeVipStatus(u) {
            const label = u.planCategory || 'Manual';
            const tier = label === 'Manual' ? 'Manual' : (/^Diamond/.test(label) ? 'Diamond' : (/^Black/.test(label) ? 'Black' : 'Básico'));
            if (!u.vip_until) return `${tier} • sem expiração`;
            const until = new Date(u.vip_until);
            const daysLeft = Math.max(0, Math.ceil((until - new Date()) / 86400000));
            return `${tier} (${label}) • ${daysLeft} dia(s) restante(s) • expira ${until.toLocaleDateString('pt-BR')}`;
        }

        async function searchUsers() {
            const si = document.getElementById('user-search-query');
            const sb = document.getElementById('search-user-btn');
            let query = si?.value?.trim();
            if (!query || !currentModToken) return;
            if (query.startsWith('#')) {
                query = query.substring(1).trim();
            }
            if (sb) sb.disabled = true;
            try {
                const res = await fetch(`/api/admin/user-admin?query=${encodeURIComponent(query)}&token=${encodeURIComponent(currentModToken)}`);
                const data = await res.json();
                const users = data.users || [];
                
                document.getElementById('search-results').innerHTML = (users.length === 0) 
                    ? '<div class="bg-white/5 border border-white/5 rounded-3xl p-10 text-center"><p class="text-gray-600 uppercase text-[10px] font-black tracking-[0.3em]">Nenhum usuário encontrado</p></div>'
                    : users.map(u => {
                        const isVip = u.is_vip === true && (!u.vip_until || new Date(u.vip_until) > new Date());
                        const betterId = u.id.substring(0, 8).toUpperCase();
                        const actionButtonHtml = isVip 
                            ? `<div class="flex flex-wrap items-center justify-end gap-3">
                                   <input type="number" min="1" max="3650" value="30" id="extend-days-${u.id}" aria-label="Dias a adicionar" class="w-20 bg-black/60 border border-white/10 rounded-xl px-3 py-2.5 text-[10px] text-white focus:outline-none focus:border-[#DF0912] font-bold" />
                                   <button class="toggle-vip-btn px-6 py-2.5 rounded-xl font-black uppercase text-[10px] tracking-widest transition-all bg-[#DF0912] text-white hover:scale-105 active:scale-95" data-id="${u.id}" data-action="extend">
                                       + Dias
                                   </button>
                                   <button class="toggle-vip-btn px-6 py-2.5 rounded-xl font-black uppercase text-[10px] tracking-widest transition-all bg-white/5 text-white border border-white/10 hover:bg-white/10 active:scale-95" data-id="${u.id}" data-action="shrink">
                                       − Dias
                                   </button>
                                   <button class="toggle-vip-btn px-8 py-3.5 rounded-2xl font-black uppercase text-[10px] tracking-widest transition-all bg-white/5 text-red-500 border border-red-500/20 hover:bg-red-500/10 active:scale-95" data-id="${u.id}" data-action="remove">
                                       Remover VIP
                                   </button>
                               </div>`
                            : `<div class="flex flex-wrap items-center gap-3">
                                   <select id="grant-plan-type-${u.id}" class="bg-black/60 border border-white/10 rounded-xl px-3 py-2.5 text-[10px] text-white focus:outline-none focus:border-[#DF0912] font-bold uppercase tracking-wider">
                                       <option value="basic">VIP Básico</option>
                                       <option value="diamond">VIP Diamond 💎</option>
                                       <option value="black">VIP Black 🖤</option>
                                   </select>
                                   <select id="grant-duration-${u.id}" class="bg-black/60 border border-white/10 rounded-xl px-3 py-2.5 text-[10px] text-white focus:outline-none focus:border-[#DF0912] font-bold uppercase tracking-wider">
                                       <option value="mensal">Mensal (30d)</option>
                                       <option value="trimestral">Trimestral (90d)</option>
                                       <option value="anual">Anual (365d)</option>
                                   </select>
                                   <button class="toggle-vip-btn px-6 py-2.5 rounded-xl font-black uppercase text-[10px] tracking-widest transition-all bg-[#DF0912] text-white shadow-xl shadow-red-900/20 hover:scale-105 active:scale-95 animate-pulse" data-id="${u.id}" data-action="activate">
                                       Conceder VIP
                                   </button>
                               </div>`;

                        return `
                        <div class="bg-white/5 border border-white/10 rounded-[26px] p-6 flex flex-col lg:flex-row items-center justify-between gap-6 hover:bg-white/[0.07] transition-all">
                            <div class="flex items-center gap-5">
                                <div class="w-14 h-14 ${isVip ? 'bg-[#DF0912]/20 text-[#DF0912]' : 'bg-white/5 text-gray-600'} rounded-2xl flex items-center justify-center font-black border border-white/5 shadow-inner">${betterId.charAt(0)}</div>
                                <div>
                                    <div class="flex items-center gap-2">
                                        <h4 class="text-white font-black text-sm uppercase italic tracking-tight">${u.email || 'Anônimo'}${u.nickname ? ` <span class="text-xs text-gray-400 normal-case">(@${u.nickname})</span>` : ''}</h4>
                                        <span class="px-1.5 py-0.5 bg-white/10 rounded text-[9px] font-mono text-gray-400">#${betterId}</span>
                                    </div>
                                    <span class="${isVip ? 'text-emerald-400 font-bold' : 'text-gray-500'} text-[10px] font-black uppercase mt-1 block tracking-widest">${isVip ? `💎 VIP ATIVO — ${describeVipStatus(u)}` : 'CONTA FREE'}</span>
                                </div>
                            </div>
                            ${actionButtonHtml}
                        </div>`;
                    }).join('');

                document.querySelectorAll('.toggle-vip-btn').forEach(b => {
                    b.onclick = async () => {
                        const action = b.getAttribute('data-action');
                        const uId = b.getAttribute('data-id');
                        
                        let planType = 'basic';
                        let duration = 'mensal';
                        let confirmMsg = "⛔ Remover acesso VIP?";
                        
                        if (action === 'activate') {
                            const selectType = document.getElementById(`grant-plan-type-${uId}`);
                            const selectDur = document.getElementById(`grant-duration-${uId}`);
                            if (selectType) planType = selectType.value;
                            if (selectDur) duration = selectDur.value;
                            
                            const planTitle = planType === 'black' ? 'Black 🖤' : (planType === 'diamond' ? 'Diamond 💎' : 'Básico');
                            const durTitle = duration === 'mensal' ? '30 dias' : (duration === 'trimestral' ? '90 dias' : '365 dias');
                            confirmMsg = `💎 Conceder plano MultiCanaisHD VIP ${planTitle} (${durTitle}) para o usuário?`;
                        }
                        
                        let days;
                        if (action === 'extend' || action === 'shrink') {
                            days = parseInt(document.getElementById(`extend-days-${uId}`)?.value, 10);
                            if (!(days >= 1 && days <= 3650)) return alert('Informe de 1 a 3650 dias.');
                            const removing = action === 'shrink';
                            if (removing) days = -days;
                            confirmMsg = removing
                                ? `➖ Remover ${-days} dia(s) do VIP do usuário?`
                                : `➕ Adicionar ${days} dia(s) ao VIP do usuário?`;
                        }

                        if (!confirm(confirmMsg)) return;

                        const res = await fetch('/api/admin/user-admin', {
                            method: 'POST', 
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ 
                                userId: uId, 
                                action: action === 'shrink' ? 'extend' : action,
                                planType: planType, 
                                duration: duration,
                                days: days,
                                token: currentModToken
                            }) 
                        });

                        if (res.ok) {
                            const state = authStore.get();
                            if (state.user && state.user.id === b.getAttribute('data-id')) {
                                await initAuth(true);
                            }
                            searchUsers();
                            return;
                        }
                        const err = await res.json().catch(() => ({}));
                        alert(err.error === 'Would expire VIP'
                            ? 'Isso vence o VIP agora. Use "Remover VIP" se for essa a intenção.'
                            : 'Não foi possível atualizar o VIP.');
                    };
                });
            } finally { 
                if (sb) sb.disabled = false; 
            }
        }

        async function fetchActiveVipsList() {
            if (!currentModToken) return;
            const loader = document.getElementById('vips-list-loader');
            const vipsList = document.getElementById('vips-list');
            if (!vipsList) return;

            loader?.classList.remove('hidden');
            try {
                const res = await fetch(`/api/admin/user-admin?token=${encodeURIComponent(currentModToken)}`);
                const data = await res.json();
                const users = data.users || [];

                // Salva em cache global para filtragem instantânea sem requisições adicionais
                window._allVipsCache = users;

                renderActiveVipsList(users);
            } catch (e) {
                console.error("Error fetching VIPs list:", e);
            } finally {
                loader?.classList.add('hidden');
            }
        }

        function renderActiveVipsList(users) {
            const vipsList = document.getElementById('vips-list');
            const totalCount = document.getElementById('vips-total-count');
            const filterSelect = document.getElementById('vip-plan-filter');
            if (!vipsList) return;

            const selectedFilter = filterSelect ? filterSelect.value : '';

            // Filtrar os usuários com base no plano selecionado
            const filteredUsers = selectedFilter
                ? users.filter(u => u.planCategory === selectedFilter)
                : users;

            if (totalCount) {
                totalCount.textContent = selectedFilter 
                    ? `${filteredUsers.length} de ${users.length}`
                    : users.length;
            }

            if (filteredUsers.length === 0) {
                vipsList.innerHTML = `
                    <div class="bg-white/5 border border-white/5 rounded-3xl p-10 text-center">
                        <p class="text-gray-600 uppercase text-[10px] font-black tracking-[0.3em]">Nenhum usuário VIP corresponde a este plano</p>
                    </div>
                `;
                return;
            }

            vipsList.innerHTML = filteredUsers.map(u => {
                const betterId = u.id.substring(0, 8).toUpperCase();
                const acquiredStr = u.acquiredAt 
                    ? new Date(u.acquiredAt).toLocaleString('pt-BR') 
                    : 'Manual / Admin';
                const expiresStr = u.vip_until 
                    ? new Date(u.vip_until).toLocaleString('pt-BR') 
                    : 'Sem expiração';

                return `
                    <div class="bg-white/5 border border-white/5 rounded-[26px] p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 hover:bg-white/[0.08] transition-all">
                        <div class="flex items-start sm:items-center gap-5 min-w-0 flex-1">
                            <div class="w-14 h-14 bg-[#DF0912]/10 text-[#DF0912] rounded-2xl flex items-center justify-center font-black border border-[#DF0912]/10 shadow-inner shrink-0">${betterId.charAt(0)}</div>
                            <div class="min-w-0 flex-1">
                                <div class="flex items-center gap-2 flex-wrap">
                                    <h4 class="text-white font-black text-sm uppercase italic tracking-tight truncate max-w-xs" title="${u.email || 'Anônimo'}">${u.email || 'Anônimo'}${u.nickname ? ` (@${u.nickname})` : ''}</h4>
                                    <span class="px-1.5 py-0.5 bg-white/15 rounded text-[9px] font-mono text-gray-400 font-bold tracking-wider" title="Melhor ID para pesquisa rápida">#${betterId}</span>
                                    <span class="px-1.5 py-0.5 bg-white/5 rounded text-[8px] font-mono text-gray-600 hidden lg:inline truncate max-w-[200px]" title="ID Completo: ${u.id}">${u.id}</span>
                                </div>
                                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                                    <span class="text-emerald-400 font-black">💎 ${u.planCategory || 'Manual'}</span>
                                    <span class="text-gray-600 shrink-0">•</span>
                                    <span class="shrink-0">Adquirido: <span class="text-gray-300 font-mono text-[10px] font-normal normal-case">${acquiredStr}</span></span>
                                    <span class="text-gray-600 shrink-0">•</span>
                                    <span class="shrink-0">Expira: <span class="text-red-400 font-mono text-[10px] font-normal normal-case">${expiresStr}</span></span>
                                </div>
                            </div>
                        </div>
                        <button class="remove-vip-list-btn shrink-0 px-6 py-3 rounded-xl font-black uppercase text-[9px] tracking-widest transition-all bg-white/5 text-red-500 border border-red-500/10 hover:bg-red-500/10 active:scale-95" data-id="${u.id}">
                            Remover VIP
                        </button>
                    </div>
                `;
            }).join('');

            // Vincular botões de remoção
            vipsList.querySelectorAll('.remove-vip-list-btn').forEach(b => {
                b.onclick = async () => {
                    if (!confirm("⛔ Remover acesso VIP deste usuário?")) return;
                    
                    const res = await fetch('/api/admin/user-admin', { 
                        method: 'POST', 
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userId: b.getAttribute('data-id'), action: 'remove', token: currentModToken }) 
                    });

                    if (res.ok) {
                        const state = authStore.get();
                        if (state.user && state.user.id === b.getAttribute('data-id')) {
                            await initAuth(true);
                        }
                        fetchActiveVipsList();
                    }
                };
            });
        }

        function logout() {
            localStorage.removeItem('bf_mod_token');
            currentModToken = '';
            authSection?.classList.remove('hidden');
            dashboardContent?.classList.add('hidden');
            tabsContainer?.classList.add('hidden');
            // Clear dashboard content for security
            if (dashboardContent) dashboardContent.innerHTML = '';
        }

        function statusColorClass(status) {
            if (status >= 500) return 'text-red-400';
            if (status >= 400) return 'text-yellow-400';
            if (status >= 300) return 'text-sky-400';
            return 'text-emerald-400';
        }

        function healthColorClasses(status) {
            if (status === 'online') return { dot: 'bg-emerald-500', text: 'text-emerald-400' };
            if (status === 'instavel') return { dot: 'bg-yellow-500', text: 'text-yellow-400' };
            return { dot: 'bg-[#DF0912]', text: 'text-[#DF0912]' };
        }

        const SERVICE_DISPLAY_NAMES = {
            supabase: 'Banco de Dados',
            redis: 'Cache',
            tmdb: 'Metadados',
            xtream: 'Player VIP',
            superflix: 'Player Principal',
            fembed: 'Player Secundário',
            videasy: 'Player Auxiliar',
            canais: 'Canais de TV',
        };

        let lastMonitoringErrors = [];
        let lastMonitoringRequests = [];

        function openMonitoringModal(title, bodyHtml) {
            const modal = document.getElementById('monitoring-detail-modal');
            const titleEl = document.getElementById('monitoring-detail-title');
            const bodyEl = document.getElementById('monitoring-detail-body');
            if (!modal || !titleEl || !bodyEl) return;
            titleEl.textContent = title;
            bodyEl.innerHTML = bodyHtml;
            modal.classList.remove('hidden');
        }

        function closeMonitoringModal() {
            document.getElementById('monitoring-detail-modal')?.classList.add('hidden');
        }

        function detailRow(label, value) {
            if (!value) return '';
            return `<div class="border-b border-white/5 pb-2">
                <p class="text-gray-500 text-[9px] font-black uppercase tracking-widest mb-1">${escapeHtml(label)}</p>
                <p class="text-gray-200 font-mono text-[11px] break-all whitespace-pre-wrap">${escapeHtml(String(value))}</p>
            </div>`;
        }

        function showErrorDetail(ev) {
            const time = ev._time ? new Date(ev._time).toLocaleString('pt-BR') : '?';
            openMonitoringModal('Detalhes do Erro', [
                detailRow('Data/Hora', time),
                detailRow('Rota', ev.rota),
                detailRow('Serviço', ev.servico),
                detailRow('Função', ev.funcao),
                detailRow('Código', ev.code),
                detailRow('Mensagem', ev.message),
                detailRow('Stack Trace', ev.stack),
            ].join(''));
        }

        function showRequestDetail(ev) {
            const time = ev._time ? new Date(ev._time).toLocaleString('pt-BR') : '?';
            openMonitoringModal('Detalhes da Requisição', [
                detailRow('Data/Hora', time),
                detailRow('Método', ev.method),
                detailRow('URL', ev.url),
                detailRow('Status', ev.status),
                detailRow('Duração', ev.duration_ms != null ? `${ev.duration_ms}ms` : null),
                detailRow('Host', ev.host),
                detailRow('Referer', ev.referer),
                detailRow('User Agent', ev.userAgent),
                detailRow('IP (parcial)', ev.ip),
            ].join(''));
        }

        function bindMonitoringModalOnce() {
            const modal = document.getElementById('monitoring-detail-modal');
            if (!modal || modal.dataset.bound === 'true') return;
            modal.dataset.bound = 'true';
            document.getElementById('monitoring-detail-close')?.addEventListener('click', closeMonitoringModal);
            modal.addEventListener('click', (e) => { if (e.target === modal) closeMonitoringModal(); });
        }

        async function fetchMonitoringStats(forceReload = false) {
            if (!currentModToken) return;
            bindMonitoringModalOnce();
            const loader = document.getElementById('monitoring-loader');
            const healthGrid = document.getElementById('monitoring-health-grid');
            const errorsList = document.getElementById('monitoring-errors-list');
            const errorsEmpty = document.getElementById('monitoring-errors-empty');
            const requestsTbody = document.getElementById('monitoring-requests-tbody');
            const requestsEmpty = document.getElementById('monitoring-requests-empty');
            const count5xx = document.getElementById('monitoring-5xx-count');
            if (!healthGrid) return;

            loader?.classList.remove('hidden');
            try {
                const res = await fetch(`/api/admin/monitoring-stats?token=${encodeURIComponent(currentModToken)}${forceReload ? '&nocache=true' : ''}`);
                const data = await res.json();

                // Saúde de infraestrutura
                const health = data.health || {};
                const healthKeys = Object.keys(health);
                if (healthKeys.length === 0) {
                    healthGrid.innerHTML = `<p class="text-gray-500 text-xs font-bold col-span-full">Sem dados de saúde disponíveis.</p>`;
                } else {
                    healthGrid.innerHTML = healthKeys.map((key) => {
                        const svc = health[key];
                        const colors = healthColorClasses(svc?.status);
                        const label = SERVICE_DISPLAY_NAMES[key] || key;
                        return `<div class="rounded-2xl bg-white/[0.03] border border-white/5 px-4 py-3">
                            <p class="text-[9px] text-gray-500 font-black uppercase tracking-widest flex items-center gap-2">
                                <span class="w-1.5 h-1.5 rounded-full ${colors.dot}"></span> ${escapeHtml(label)}
                            </p>
                            <p class="${colors.text} text-xs font-black uppercase tracking-wider mt-1">${escapeHtml(svc?.status || 'desconhecido')}</p>
                            <p class="text-gray-600 text-[9px] font-bold mt-1">${svc?.latency ?? 0}ms</p>
                        </div>`;
                    }).join('');
                }

                // Erros recentes
                lastMonitoringErrors = data.recentErrors || [];
                if (count5xx) count5xx.textContent = `${data.serverErrorCount5xx || 0} erros 5xx (1h)`;
                if (lastMonitoringErrors.length === 0) {
                    errorsEmpty?.classList.remove('hidden');
                    if (errorsList) errorsList.innerHTML = '';
                } else {
                    errorsEmpty?.classList.add('hidden');
                    if (errorsList) {
                        errorsList.innerHTML = lastMonitoringErrors.map((ev, i) => {
                            const time = ev._time ? new Date(ev._time).toLocaleString('pt-BR') : '?';
                            const rota = ev.rota || ev.servico || '';
                            return `<div class="p-4 sm:p-5 cursor-pointer hover:bg-white/[0.03] transition-colors" data-error-index="${i}">
                                <div class="flex items-center justify-between gap-3 mb-1">
                                    <span class="text-[#DF0912] text-[10px] font-black uppercase tracking-widest">${escapeHtml(rota)}</span>
                                    <span class="text-gray-600 text-[9px] font-bold">${time}</span>
                                </div>
                                <p class="text-gray-400 text-xs font-medium break-all line-clamp-2">${escapeHtml(ev.message || '')}</p>
                            </div>`;
                        }).join('');
                        errorsList.querySelectorAll('[data-error-index]').forEach((el) => {
                            el.addEventListener('click', () => showErrorDetail(lastMonitoringErrors[Number(el.getAttribute('data-error-index'))]));
                        });
                    }
                }

                // Requisições recentes
                lastMonitoringRequests = data.recentRequests || [];
                if (lastMonitoringRequests.length === 0) {
                    requestsEmpty?.classList.remove('hidden');
                    if (requestsTbody) requestsTbody.innerHTML = '';
                } else {
                    requestsEmpty?.classList.add('hidden');
                    if (requestsTbody) {
                        requestsTbody.innerHTML = lastMonitoringRequests.map((ev, i) => {
                            const time = ev._time ? new Date(ev._time).toLocaleTimeString('pt-BR') : '?';
                            const isLocal = /localhost|127\.0\.0\.1/i.test(ev.host || '');
                            const originLabel = isLocal ? 'Dev (local)' : (ev.host || 'Produção');
                            const originColor = isLocal ? 'text-yellow-400' : 'text-emerald-400';
                            return `<tr class="cursor-pointer hover:bg-white/[0.03] transition-colors" data-request-index="${i}">
                                <td class="px-6 py-4 text-gray-400 text-[10px] font-mono whitespace-nowrap">${time}</td>
                                <td class="px-6 py-4 text-[10px] font-black ${originColor}">${escapeHtml(originLabel)}</td>
                                <td class="px-6 py-4 text-white text-[10px] font-black uppercase">${escapeHtml(ev.method || '')}</td>
                                <td class="px-6 py-4 text-gray-300 text-[10px] font-mono truncate max-w-xs">${escapeHtml(ev.url || '')}</td>
                                <td class="px-6 py-4 text-[10px] font-black ${statusColorClass(Number(ev.status) || 0)}">${ev.status ?? '?'}</td>
                                <td class="px-6 py-4 text-gray-500 text-[10px] font-mono text-right">${ev.duration_ms ?? '?'}ms</td>
                            </tr>`;
                        }).join('');
                        requestsTbody.querySelectorAll('[data-request-index]').forEach((el) => {
                            el.addEventListener('click', () => showRequestDetail(lastMonitoringRequests[Number(el.getAttribute('data-request-index'))]));
                        });
                    }
                }
            } catch (err) {
                console.error('[Monitoring] Falha ao buscar estatísticas:', err);
            } finally {
                loader?.classList.add('hidden');
            }
        }

        // Converte o path (ex: /filme/123-nome-do-filme) num título legível pro painel,
        // sem depender de mais uma chamada ao TMDB — o slug já carrega o nome do título.
        function pathToLabel(path) {
            if (!path) return '—';
            const staticLabels = { '/': 'Início', '/explorar': 'Explorar', '/vip': 'VIP', '/ranking': 'Ranking' };
            if (staticLabels[path]) return staticLabels[path];

            const match = path.match(/^\/(filme|serie|genero|canal)\/\d*-?(.+)$/);
            if (!match) return path;

            const kindLabels = { filme: 'Filme', serie: 'Série', genero: 'Gênero', canal: 'Canal' };
            const readable = match[2].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
            return `${kindLabels[match[1]]}: ${readable}`;
        }

        function timeAgoLabel(iso) {
            if (!iso) return '';
            const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
            if (diffSec < 60) return 'agora';
            return `${Math.floor(diffSec / 60)}min atrás`;
        }

        function renderOnlineUsers(list) {
            const container = document.getElementById('admin-online-users-list');
            if (!container) return;
            if (!list.length) {
                container.innerHTML = '<p class="text-[10px] text-gray-600 font-bold uppercase tracking-widest">Ninguém online no momento.</p>';
                return;
            }
            // Quantos estao assistindo fora do dominio (player externo) — sem isso a queda de
            // visitantes no site parece perda de audiencia, quando na verdade e migracao.
            const externos = list.filter((u) => u.externo).length;
            const resumo = externos > 0
                ? `<p class="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-2">${list.length} online · <span class="text-[#DF0912]">${externos} no player externo</span></p>`
                : `<p class="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-2">${list.length} online</p>`;

            container.innerHTML = resumo + list.map((u) => `
                <div class="min-w-0 py-2 border-b border-white/5 last:border-0">
                    <div class="flex items-center justify-between gap-2">
                        <span class="text-white font-bold text-[11px] truncate">${escapeHtml(u.label || 'Visitante')}${u.externo ? ' <span class="text-[#DF0912] text-[9px] font-mono uppercase">ext</span>' : ''}</span>
                        <span class="text-gray-600 text-[9px] font-mono uppercase tracking-wider shrink-0">${timeAgoLabel(u.lastSeen)}</span>
                    </div>
                    <p class="text-gray-400 text-[10px] font-mono truncate mt-0.5">${escapeHtml(pathToLabel(u.path))}</p>
                </div>
            `).join('');
        }

        async function fetchStats(forceReload = false) {
            if (!currentModToken) return;
            try {
                const res = await fetch(`/api/admin/stats?token=${encodeURIComponent(currentModToken)}${forceReload ? '&nocache=true' : ''}`);
                const data = await res.json();

                // Counters
                document.getElementById('admin-stat-online').textContent = data.onlineNow || '0';
                renderOnlineUsers(data.onlineUsers || []);
                document.getElementById('admin-stat-users').textContent = data.totalUsers || '0';
                document.getElementById('admin-stat-vip').textContent = data.vipUsers || '0';

                // Detailed Counters
                const statVip10 = document.getElementById('admin-stat-vip-10');
                const statVip25 = document.getElementById('admin-stat-vip-25');
                const statVip80 = document.getElementById('admin-stat-vip-80');
                const statVipDiamond19 = document.getElementById('admin-stat-vip-diamond-19');
                const statVipDiamond49 = document.getElementById('admin-stat-vip-diamond-49');
                const statVipDiamond149 = document.getElementById('admin-stat-vip-diamond-149');
                const statVipBlack50 = document.getElementById('admin-stat-vip-black-50');
                const statVipBlack125 = document.getElementById('admin-stat-vip-black-125');
                const statVipBlack500 = document.getElementById('admin-stat-vip-black-500');
                const statVipManual = document.getElementById('admin-stat-vip-manual');

                if (statVip10) statVip10.textContent = data.vip10Count !== undefined ? data.vip10Count : '...';
                if (statVip25) statVip25.textContent = data.vip25Count !== undefined ? data.vip25Count : '...';
                if (statVip80) statVip80.textContent = data.vip80Count !== undefined ? data.vip80Count : '...';
                if (statVipDiamond19) statVipDiamond19.textContent = data.vipDiamond19Count !== undefined ? data.vipDiamond19Count : '...';
                if (statVipDiamond49) statVipDiamond49.textContent = data.vipDiamond49Count !== undefined ? data.vipDiamond49Count : '...';
                if (statVipDiamond149) statVipDiamond149.textContent = data.vipDiamond149Count !== undefined ? data.vipDiamond149Count : '...';
                if (statVipBlack50) statVipBlack50.textContent = data.vipBlack50Count !== undefined ? data.vipBlack50Count : '...';
                if (statVipBlack125) statVipBlack125.textContent = data.vipBlack125Count !== undefined ? data.vipBlack125Count : '...';
                if (statVipBlack500) statVipBlack500.textContent = data.vipBlack500Count !== undefined ? data.vipBlack500Count : '...';
                if (statVipManual) statVipManual.textContent = data.vipManualCount !== undefined ? data.vipManualCount : '...';
            } catch (e) {
                console.error("Error fetching stats:", e);
            }
        }

        loginBtn.onclick = () => login(tokenInput?.value);
        if (tokenInput) tokenInput.onkeydown = (e) => { if (e.key === 'Enter') login(tokenInput.value); };
        
        async function fetchChannels() {
            const grid = document.getElementById('channels-grid');
            const loader = document.getElementById('channels-loader');
            if (!grid || !currentModToken) return;

            loader?.classList.remove('hidden');
            try {
                const [resChannels, resVip] = await Promise.all([
                    fetch(`/api/admin/get-channels-list?token=${encodeURIComponent(currentModToken)}`),
                    fetch(`/api/admin/channels-admin?token=${encodeURIComponent(currentModToken)}`)
                ]);

                const channelsData = await resChannels.json();
                const vipData = await resVip.json();
                const allChannels = channelsData.channels || [];
                const vipIds = new Set(vipData.vipChannels || []);

                const categoryFilter = document.getElementById('channel-category-filter');
                if (categoryFilter) {
                    const currentVal = categoryFilter.value;
                    const categories = [...new Set(allChannels.map(c => c.categoria).filter(Boolean))].sort();
                    categoryFilter.innerHTML = '<option value="">Todas Categorias</option>' + 
                        categories.map(cat => `<option value="${cat}" ${cat === currentVal ? 'selected' : ''}>${cat}</option>`).join('');
                }

                window._allChannelsCache = allChannels;
                window._vipIdsCache = vipIds;
                renderChannels(allChannels, vipIds);
            } catch (e) {
                console.error("Error fetching channels:", e);
            } finally {
                loader?.classList.add('hidden');
            }
        }

        function renderChannels(channels, vipIds) {
            const grid = document.getElementById('channels-grid');
            const search = document.getElementById('channel-search');
            const categoryFilter = document.getElementById('channel-category-filter');
            if (!grid) return;

            const filterText = search?.value?.toLowerCase() || '';
            const filterCat = categoryFilter?.value || '';

            const filtered = channels.filter(c => {
                const matchesText = c.nome.toLowerCase().includes(filterText);
                const matchesCat = !filterCat || c.categoria === filterCat;
                return matchesText && matchesCat;
            });

            const totalCounter = document.getElementById('channels-total-count');
            if (totalCounter) totalCounter.textContent = `${filtered.length} de ${channels.length}`;

            grid.innerHTML = filtered.map(c => {
                const id = String(c.id);
                const isVip = vipIds.has(id);
                
                return `
                    <div class="bg-white/[0.03] border border-white/5 rounded-2xl p-4 flex items-center justify-between gap-4 group hover:bg-white/[0.07] hover:border-white/10 transition-all duration-300 shadow-md shadow-black/10">
                        <div class="flex items-center gap-3.5 flex-1 min-w-0">
                            <div class="w-12 h-12 bg-black/40 rounded-xl flex items-center justify-center p-1.5 border border-white/5 group-hover:border-[#DF0912]/30 group-hover:scale-105 transition-all duration-300 flex-shrink-0 shadow-inner">
                                <img src="${c.imagem}" alt="${c.nome}" class="w-full h-full object-contain" onerror="this.src='https://placehold.co/40x40/141414/333333?text=TV'" />
                            </div>
                            <div class="min-w-0 flex-1">
                                <p class="text-white text-[12px] font-black uppercase italic tracking-wide break-words leading-snug group-hover:text-[#DF0912] transition-colors duration-300" title="${c.nome}">${c.nome}</p>
                                <div class="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                    <span class="${isVip ? 'text-[#DF0912] bg-[#DF0912]/5 border border-[#DF0912]/10 shadow-[0_0_8px_rgba(223,9,18,0.05)]' : 'text-emerald-500 bg-emerald-500/5 border border-emerald-500/10'} text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md">${isVip ? '💎 PREMIUM' : 'FREE'}</span>
                                    <span class="text-gray-600 text-[8px] font-black uppercase flex-shrink-0">•</span>
                                    <span class="text-gray-400 bg-white/5 border border-white/5 text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md">${c.categoria || 'Sem Cat.'}</span>
                                </div>
                            </div>
                        </div>
                        <button class="toggle-channel-vip-btn p-2.5 rounded-xl transition-all duration-300 flex-shrink-0 active:scale-95 ${isVip ? 'text-gray-400 hover:text-white bg-white/5 border border-white/5 hover:bg-white/10' : 'text-[#DF0912] bg-[#DF0912]/10 hover:bg-[#DF0912] hover:text-white border border-[#DF0912]/10 shadow-lg shadow-red-900/5 hover:shadow-red-900/20'}" data-id="${id}" data-action="${isVip ? 'remove' : 'activate'}" title="${isVip ? 'Tornar Grátis' : 'Tornar Premium'}">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="${isVip ? 'M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z' : 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z'}"/></svg>
                        </button>
                    </div>
                `;
            }).join('');

            document.querySelectorAll('.toggle-channel-vip-btn').forEach(btn => {
                btn.onclick = async () => {
                    const id = btn.dataset.id;
                    const action = btn.dataset.action;
                    await fetch('/api/admin/channels-admin', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ channelId: id, action: action, token: currentModToken })
                    });
                    fetchChannels();
                };
            });
        }

        // ==========================================
        // URL ROTATION (ANTI-DMCA)
        // ==========================================
        function bindUrlRotationElements() {
            const modeSingleBtn = document.getElementById('rot-mode-single');
            const modeBatchBtn = document.getElementById('rot-mode-batch');
            const singleForm = document.getElementById('single-rotation-form');
            const batchForm = document.getElementById('batch-rotation-form');
            const refreshBtn = document.getElementById('refresh-rotations-btn');
            const syncBtn = document.getElementById('sync-rotations-btn');
            const clearBtn = document.getElementById('clear-rotations-btn');

            // Classes sincronizadas com UrlRotationSection.astro (mesmo padrão sóbrio do
            // resto do /moderacao, sem o uppercase/font-black da versão antiga).
            const rotModeActive = "px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors bg-[#DF0912] text-white";
            const rotModeInactive = "px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors text-gray-400 hover:text-white";

            if (modeSingleBtn && modeBatchBtn) {
                modeSingleBtn.onclick = () => {
                    modeSingleBtn.className = rotModeActive;
                    modeBatchBtn.className = rotModeInactive;
                    singleForm?.classList.remove('hidden');
                    batchForm?.classList.add('hidden');
                };
                modeBatchBtn.onclick = () => {
                    modeBatchBtn.className = rotModeActive;
                    modeSingleBtn.className = rotModeInactive;
                    batchForm?.classList.remove('hidden');
                    singleForm?.classList.add('hidden');
                };
            }

            if (singleForm) {
                singleForm.onsubmit = async (e) => {
                    e.preventDefault();
                    await handleSingleRotation();
                };
            }

            if (batchForm) {
                batchForm.onsubmit = async (e) => {
                    e.preventDefault();
                    await handleBatchRotation();
                };

                const formatBatchBtn = document.getElementById('btn-format-batch');
                const batchInput = document.getElementById('rot-batch-input');
                if (formatBatchBtn && batchInput) {
                    formatBatchBtn.onclick = () => {
                        const raw = batchInput.value || '';
                        if (!raw.trim()) return;

                        const cleanedLines = raw.split('\n').map(line => {
                            let l = line.trim();
                            if (!l) return '';
                            // 1. hxxp / hxxps -> http / https
                            l = l.replace(/^hxxp(s?):\/\//i, 'http$1://');
                            // 2. [.] ou (.) -> .
                            l = l.replace(/\[\.\]/g, '.').replace(/\(\.\)/g, '.');
                            // 3. &amp; -> &
                            l = l.replace(/&amp;/g, '&');
                            // 4. Remove query params (?season=... &episode=...) e hash
                            l = l.split('?')[0].split('#')[0];
                            return l;
                        }).filter(Boolean);

                        batchInput.value = cleanedLines.join('\n');
                        const origHtml = formatBatchBtn.innerHTML;
                        formatBatchBtn.innerHTML = `<span>Formatado! ✨</span>`;
                        setTimeout(() => { formatBatchBtn.innerHTML = origHtml; }, 1500);
                    };
                }
            }

            if (refreshBtn) {
                refreshBtn.onclick = () => fetchUrlRotations();
            }

            if (syncBtn) {
                syncBtn.onclick = () => fetchUrlRotations(true);
            }

            if (clearBtn) {
                clearBtn.onclick = async () => {
                    if (!confirm("⚠️ TEM CERTEZA? Isso limpará todas as rotações ativas registradas.")) return;
                    await handleClearAllRotations();
                };
            }

            const checkBlocksBtn = document.getElementById('check-blocks-btn');
            const rotateBlockedBtn = document.getElementById('rotate-blocked-btn');
            if (checkBlocksBtn) checkBlocksBtn.onclick = () => verificarBloqueiosLegais();
            if (rotateBlockedBtn) rotateBlockedBtn.onclick = () => rotacionarBloqueadas();

            // Checagem de URLs soltas (inclusive /en/) — lógica no módulo checkUrlsClient.js.
            const checkUrlsBtn = document.getElementById('check-urls-btn');
            if (checkUrlsBtn) {
                inicializarCheckUrls({ obterToken: () => currentModToken, escapeHtml });
            }

            // Detecção automática de 451 (toggle + log) — dmcaWatchClient.js.
            inicializarDmcaWatch({ obterToken: () => currentModToken, escapeHtml });
        }

        // ====================================================================
        // BLOQUEIO LEGAL (451 do Cloudflare)
        //
        // O Cloudflare responde 451 ANTES da requisição chegar no Worker, então o servidor não
        // tem como saber quais URLs estão bloqueadas — o log de requisição nem vê a requisição.
        // O NAVEGADOR do painel tem: /moderacao e /serie/... são o mesmo domínio, então cada
        // HEAD daqui passa pelo WAF igual a qualquer visita e o status é legível (same-origin,
        // sem CORS no caminho).
        //
        // O que isso resolve: medido em 16/10/2026, 45 URLs de conteúdo tinham o PRÓPRIO slug
        // canônico respondendo 451, porque o bloqueio chegou depois da última rotação. Rotacionar
        // de novo move o canônico para um slug livre, que volta a 200 e entra no sitemap.
        //
        // O que NÃO resolve: bloqueio que caiu na URL /en/ da obra. Este botão testa e rotaciona
        // só a URL em português (current_slug). Para o /en existe rotação própria desde a
        // MELHORIA 1 — use o seletor de idioma do formulário abaixo, ou cole a URL /en/ na
        // seção "Checar URLs soltas". A UI avisa isso explicitamente.
        // ====================================================================

        let ultimasRotacoes = null;
        let bloqueadasDetectadas = [];

        const definirFeedbackBloqueio = (mensagem, tipo = 'info') => {
            const el = document.getElementById('blocked-feedback');
            if (!el) return;
            if (!mensagem) {
                el.classList.add('hidden');
                return;
            }
            const variantes = {
                info: 'bg-white/[0.03] border-white/10 text-gray-300',
                ok: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300',
                erro: 'bg-[#DF0912]/10 border-[#DF0912]/30 text-red-300',
                alerta: 'bg-amber-500/10 border-amber-500/20 text-amber-300',
            };
            el.className = `p-3.5 rounded-lg border text-xs ${variantes[tipo] || variantes.info}`;
            el.innerHTML = mensagem;
            el.classList.remove('hidden');
        };

        const atualizarBotaoRotacionar = () => {
            const btn = document.getElementById('rotate-blocked-btn');
            const label = document.getElementById('rotate-blocked-label');
            if (!btn) return;
            const n = bloqueadasDetectadas.length;
            btn.disabled = n === 0;
            if (label) label.textContent = n > 0 ? `Rotacionar ${n} bloqueada${n > 1 ? 's' : ''}` : 'Rotacionar bloqueadas';
        };

        const descreverStatus = (status) => {
            if (status === 451) return { rotulo: '451 bloqueado', classe: 'bg-[#DF0912]/15 text-red-300 border-[#DF0912]/30' };
            if (status === -1) return { rotulo: 'erro de rede', classe: 'bg-[#DF0912]/15 text-red-300 border-[#DF0912]/30' };
            if (status === 0) return { rotulo: '301 redireciona', classe: 'bg-amber-500/15 text-amber-300 border-amber-500/30' };
            if (status === 404) return { rotulo: '404 não existe', classe: 'bg-amber-500/15 text-amber-300 border-amber-500/30' };
            if (status >= 500) return { rotulo: `${status} servidor`, classe: 'bg-[#DF0912]/15 text-red-300 border-[#DF0912]/30' };
            if (status !== 200) return { rotulo: `${status}`, classe: 'bg-amber-500/15 text-amber-300 border-amber-500/30' };
            return { rotulo: '200 ok', classe: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };
        };

        // HEAD com fallback pra GET: alguns proxies/regras recusam HEAD, e o objetivo aqui é
        // saber o status que o Google receberia, não economizar bytes a qualquer custo.
        async function sondarUrl(caminho) {
            try {
                let res = await fetch(caminho, { method: 'HEAD', redirect: 'manual', cache: 'no-store' });
                if (res.status === 405 || res.status === 501) {
                    res = await fetch(caminho, { method: 'GET', redirect: 'manual', cache: 'no-store' });
                }
                return res.status;
            } catch (e) {
                return -1;
            }
        }

        async function verificarBloqueiosLegais() {
            const spinner = document.getElementById('check-blocks-spinner');
            const listEl = document.getElementById('blocked-list');
            spinner?.classList.remove('hidden');
            definirFeedbackBloqueio('Testando o endereço atual de cada rotação...');

            try {
                if (!ultimasRotacoes) {
                    const res = await fetch(`/api/admin/url-rotations?token=${encodeURIComponent(currentModToken)}`);
                    const data = await res.json();
                    if (data.needMigration) {
                        definirFeedbackBloqueio('A tabela de rotações ainda não existe no banco.', 'alerta');
                        return;
                    }
                    ultimasRotacoes = data.rotations || [];
                }

                const rotações = ultimasRotacoes || [];
                if (rotações.length === 0) {
                    definirFeedbackBloqueio('Nenhuma rotação cadastrada — não há o que verificar.', 'info');
                    bloqueadasDetectadas = [];
                    atualizarBotaoRotacionar();
                    return;
                }

                const resultados = [];
                const CONCORRENCIA = 5;
                for (let i = 0; i < rotações.length; i += CONCORRENCIA) {
                    const lote = rotações.slice(i, i + CONCORRENCIA);
                    const parciais = await Promise.all(lote.map(async (item) => {
                        const rota = item.media_type === 'series' ? 'serie' : 'filme';
                        const caminho = `/${rota}/${item.current_slug}`;
                        return { item, caminho, status: await sondarUrl(caminho) };
                    }));
                    resultados.push(...parciais);
                }

                // Só 451 entra no botão de rotação. 404/5xx/erro de rede também aparecem na
                // lista (é sinal de que a obra está fora do ar), mas rotacionar não é a
                // correção para eles e poderia piorar — o slug mudaria sem resolver a causa.
                bloqueadasDetectadas = resultados.filter((r) => r.status === 451);

                if (listEl) {
                    if (resultados.length === 0) {
                        listEl.classList.add('hidden');
                    } else {
                        listEl.classList.remove('hidden');
                        listEl.innerHTML = resultados.map(({ item, caminho, status }) => {
                            const { rotulo, classe } = descreverStatus(status);
                            return `
                                <div class="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                    <div class="min-w-0 flex-1 space-y-1">
                                        <div class="flex items-center gap-2">
                                            <span class="text-xs font-medium text-white truncate max-w-[220px]" title="${escapeHtml(item.media_title || '')}">
                                                ${escapeHtml(item.media_title || `Item ${item.media_id}`)}
                                            </span>
                                            <span class="text-[10px] px-1.5 py-0.5 rounded border ${classe} font-mono">${rotulo}</span>
                                            <span class="text-[10px] text-gray-500 font-mono">v${item.rotation_count || 1}</span>
                                        </div>
                                        <div class="text-[11px] font-mono text-gray-500 truncate" title="${escapeHtml(caminho)}">${escapeHtml(caminho)}</div>
                                    </div>
                                    <a href="${escapeHtml(caminho)}" target="_blank" rel="noopener noreferrer" class="text-[10px] font-medium px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] text-gray-300 hover:text-white transition-colors shrink-0 self-end sm:self-auto">Abrir</a>
                                </div>
                            `;
                        }).join('');
                    }
                }

                const total451 = bloqueadasDetectadas.length;
                const outros = resultados.filter((r) => r.status !== 200 && r.status !== 451).length;
                if (total451 === 0 && outros === 0) {
                    // Menciona o domínio testado: depois de uma migração este resultado é sempre
                    // zero, porque os bloqueios ficaram na zona do domínio antigo. Sem dizer QUAL
                    // domínio foi testado, "nenhum bloqueio" parece bug.
                    definirFeedbackBloqueio(`✅ Nenhum bloqueio: as ${resultados.length} rotações respondem 200 no endereço atual (${window.location.origin}).`, 'ok');
                } else if (total451 === 0) {
                    definirFeedbackBloqueio(
                        `Nenhum <strong>451</strong> entre as ${resultados.length} rotações — nada a rotacionar. ` +
                        `${outros} com outro problema (404/rede/5xx), listadas abaixo para conferência manual.`,
                        'alerta'
                    );
                } else {
                    definirFeedbackBloqueio(
                        `Encontradas <strong>${total451}</strong> rotações com <strong>451</strong> no endereço atual` +
                        (outros > 0 ? ` (e ${outros} com outro problema, listadas abaixo)` : '') +
                        `. Clique em "Rotacionar" para mover o canônico delas para um slug novo.`,
                        'alerta'
                    );
                }
                atualizarBotaoRotacionar();
            } catch (err) {
                console.error('[bloqueios] Falha na verificação:', err);
                definirFeedbackBloqueio('Falha ao verificar os bloqueios. Tente novamente.', 'erro');
            } finally {
                spinner?.classList.add('hidden');
            }
        }

        async function rotacionarBloqueadas() {
            if (!bloqueadasDetectadas.length) return;
            const alvo = bloqueadasDetectadas.map(({ item }) => ({
                url: String(item.media_id),
                type: item.media_type,
            }));

            if (!confirm(`Rotacionar ${alvo.length} obra(s)? O slug canônico de cada uma muda e a URL antiga passa a responder 301.`)) return;

            const spinner = document.getElementById('rotate-blocked-spinner');
            spinner?.classList.remove('hidden');
            definirFeedbackBloqueio(`Rotacionando ${alvo.length} obra(s)...`);

            try {
                // Reusa o lote já existente: ele roda rotateMediaUrl por item e, no fim,
                // invalida o cache do sitemap (api/admin/url-rotations.js:102) — sem isso a URL
                // nova levaria até 6h pra ser anunciada.
                const res = await fetch(`/api/admin/url-rotations?token=${encodeURIComponent(currentModToken)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    // Idioma 'pt' explícito: a detecção acima só sonda caminhos em português
                    // (`/${rota}/${item.current_slug}`), então é o slug PT que precisa mudar.
                    body: JSON.stringify({ batch: alvo, lang: 'pt' }),
                });
                const data = await res.json();

                if (!res.ok || !data.success) {
                    definirFeedbackBloqueio(`Erro: ${escapeHtml(data.error || 'falha ao rotacionar')}`, 'erro');
                    return;
                }

                const erros = data.errors || [];
                definirFeedbackBloqueio(
                    `✅ ${data.rotated} obra(s) rotacionada(s) e cache do sitemap invalidado.` +
                    (erros.length ? `<br>⚠️ ${erros.length} falha(s): <span class="font-mono">${escapeHtml(erros.slice(0, 3).map(e => e.input + ' — ' + e.error).join('; '))}</span>` : ''),
                    erros.length ? 'alerta' : 'ok'
                );

                // O estado mudou: zona de detecção invalidada e histórico recarregado.
                ultimasRotacoes = null;
                bloqueadasDetectadas = [];
                atualizarBotaoRotacionar();
                document.getElementById('blocked-list')?.classList.add('hidden');
                await fetchUrlRotations(true);
            } catch (err) {
                console.error('[bloqueios] Falha ao rotacionar:', err);
                definirFeedbackBloqueio('Falha ao rotacionar as obras bloqueadas.', 'erro');
            } finally {
                spinner?.classList.add('hidden');
            }
        }

        async function fetchUrlRotations(sync = false) {
            if (!currentModToken) return;
            const loader = document.getElementById('rot-history-loader');
            const listEl = document.getElementById('rot-history-list');
            const countEl = document.getElementById('rot-history-count');
            const emptyEl = document.getElementById('rot-history-empty');
            const migrationAlert = document.getElementById('rot-migration-alert');
            const sqlCode = document.getElementById('rot-sql-code');

            if (loader) loader.classList.remove('hidden');

            try {
                const url = `/api/admin/url-rotations?token=${encodeURIComponent(currentModToken)}${sync ? '&sync=true' : ''}`;
                const res = await fetch(url);
                const data = await res.json();

                if (data.needMigration && migrationAlert && sqlCode) {
                    migrationAlert.classList.remove('hidden');
                    sqlCode.textContent = data.sql || '';
                    return;
                } else if (data.needLangMigration && migrationAlert && sqlCode) {
                    // A tabela existe, mas ainda faltam as colunas de rotação por idioma. O script
                    // exibido já contém os ALTER TABLE ... IF NOT EXISTS, e rodá-lo numa tabela
                    // existente é seguro — é assim que a migração da MELHORIA 1 chega ao banco.
                    migrationAlert.classList.remove('hidden');
                    sqlCode.textContent = data.sql || '';
                } else if (migrationAlert) {
                    migrationAlert.classList.add('hidden');
                }

                if (res.ok) {
                    const rotations = data.rotations || [];
                    // Mantém a verificação de bloqueio legal usando a MESMA lista que o
                    // histórico exibe, em vez de refazer a chamada de API.
                    ultimasRotacoes = rotations;
                    if (countEl) countEl.textContent = rotations.length;

                    if (!listEl) return;

                    if (rotations.length === 0) {
                        listEl.innerHTML = '';
                        emptyEl?.classList.remove('hidden');
                        return;
                    }

                    emptyEl?.classList.add('hidden');
                    listEl.innerHTML = rotations.map(item => {
                        const route = item.media_type === 'series' ? 'serie' : 'filme';
                        const targetUrl = `/${route}/${item.current_slug}`;
                        const updatedTime = item.updated_at ? new Date(item.updated_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
                        const updatedDate = item.updated_at ? new Date(item.updated_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '';

                        return `
                            <div class="p-4 hover:bg-white/[0.02] transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div class="min-w-0 flex-1 space-y-1">
                                    <div class="flex items-center gap-2">
                                        <span class="text-xs font-medium text-white truncate max-w-[200px] sm:max-w-[260px]" title="${escapeHtml(item.media_title || '')}">
                                            ${escapeHtml(item.media_title || `Item ${item.media_id}`)}
                                        </span>
                                        <span class="text-[10px] px-1.5 py-0.5 rounded ${item.media_type === 'series' ? 'bg-purple-500/15 text-purple-300' : 'bg-blue-500/15 text-blue-300'}">
                                            ${item.media_type === 'series' ? 'Série' : 'Filme'}
                                        </span>
                                        <span class="text-[10px] bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 rounded font-mono">
                                            v${item.rotation_count || 1}
                                        </span>
                                        ${item.current_slug_en ? `<span class="text-[10px] bg-white/[0.06] text-gray-300 px-1.5 py-0.5 rounded font-mono" title="Rotação em inglês">en v${item.rotation_count_en || 1}</span>` : ''}
                                    </div>
                                    <div class="text-[11px] font-mono text-gray-400 flex items-center gap-2 flex-wrap">
                                        <span class="line-through text-gray-500 truncate max-w-[130px]" title="${escapeHtml(item.original_slug)}">${escapeHtml(item.original_slug)}</span>
                                        <span class="text-emerald-400">➔</span>
                                        <span class="text-emerald-300 truncate max-w-[160px]" title="${escapeHtml(item.current_slug)}">${escapeHtml(item.current_slug)}</span>
                                    </div>
                                    ${item.current_slug_en ? `
                                    <div class="text-[11px] font-mono text-gray-500 flex items-center gap-2 flex-wrap">
                                        <span class="text-[9px] px-1.5 py-0.5 rounded bg-white/[0.06] text-gray-400 uppercase">en</span>
                                        <span class="line-through truncate max-w-[130px]" title="${escapeHtml(item.original_slug_en || '')}">${escapeHtml(item.original_slug_en || '')}</span>
                                        <span class="text-emerald-400">➔</span>
                                        <span class="text-emerald-300 truncate max-w-[160px]" title="${escapeHtml(item.current_slug_en)}">${escapeHtml(item.current_slug_en)}</span>
                                    </div>` : ''}
                                    <p class="text-[10px] text-gray-600 font-mono">${updatedDate} às ${updatedTime}</p>
                                </div>
                                <div class="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                                    <button
                                        type="button"
                                        class="copy-rot-btn text-[10px] font-medium px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] text-gray-300 hover:text-white transition-colors flex items-center gap-1"
                                        data-url="${targetUrl}"
                                    >
                                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                                        <span>Copiar link</span>
                                    </button>
                                    <a
                                        href="${targetUrl}"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        class="text-[10px] font-medium px-2.5 py-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 transition-colors flex items-center gap-1"
                                    >
                                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                                        <span>Abrir</span>
                                    </a>
                                    <button
                                        type="button"
                                        class="delete-rot-btn text-[10px] font-medium p-1.5 rounded-lg border border-white/5 hover:border-[#DF0912]/30 text-gray-600 hover:text-[#DF0912] hover:bg-[#DF0912]/10 transition-colors"
                                        data-id="${item.id}"
                                        title="Reverter rotação"
                                    >
                                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('');

                    // Bind copiar link
                    listEl.querySelectorAll('.copy-rot-btn').forEach(btn => {
                        btn.onclick = () => {
                            const relUrl = btn.getAttribute('data-url');
                            const full = `${window.location.origin}${relUrl}`;
                            navigator.clipboard.writeText(full);
                            const orig = btn.innerHTML;
                            btn.innerHTML = `<span>Copiado! ✅</span>`;
                            setTimeout(() => { btn.innerHTML = orig; }, 1500);
                        };
                    });

                    // Bind deletar rotação
                    listEl.querySelectorAll('.delete-rot-btn').forEach(btn => {
                        btn.onclick = async () => {
                            const id = btn.getAttribute('data-id');
                            if (!id) return;
                            if (!confirm("Reverter esta rotação e voltar ao slug original?")) return;
                            await handleDeleteRotation(id);
                        };
                    });
                }
            } catch (err) {
                console.error("[urlRotation] Erro ao buscar lista:", err);
            } finally {
                if (loader) loader.classList.add('hidden');
            }
        }

        // ------------------------------------------------------------------
        // IDIOMA DA ROTAÇÃO (pt / en / ambos)
        // "Ambos" vira DUAS chamadas de API, uma por idioma: a obra tem UMA linha em
        // url_rotations e cada idioma tem suas próprias colunas (original_slug_en,
        // current_slug_en, rotation_count_en). Não existe upsert "duplo" no servidor.
        // ------------------------------------------------------------------
        const idiomasDaSelecao = (idDoSelect) => {
            const valor = document.getElementById(idDoSelect)?.value;
            if (valor === 'ambos') return ['pt', 'en'];
            return [valor === 'en' ? 'en' : 'pt'];
        };

        const TONS_ROTACAO = {
            ok: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
            alerta: 'bg-amber-500/10 border-amber-500/20 text-amber-300',
            erro: 'bg-[#DF0912]/10 border-[#DF0912]/20 text-[#DF0912]',
        };

        const mostrarFeedbackRotacao = (html, tipo = 'ok') => {
            const el = document.getElementById('rot-action-feedback');
            if (!el) return;
            el.className = `p-3.5 rounded-lg border text-xs space-y-1 block ${TONS_ROTACAO[tipo] || TONS_ROTACAO.ok}`;
            el.innerHTML = html;
        };

        // Falta rodar o ALTER TABLE no Supabase: mostra o SQL e não finge sucesso.
        const tratarMigracaoPendente = (dados) => {
            const migrationAlert = document.getElementById('rot-migration-alert');
            const sqlCode = document.getElementById('rot-sql-code');
            if (migrationAlert && sqlCode) {
                migrationAlert.classList.remove('hidden');
                sqlCode.textContent = dados?.sql || '';
                migrationAlert.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            mostrarFeedbackRotacao(
                `O banco ainda não tem as colunas desta rotação. ${escapeHtml(dados?.error || '')} ` +
                'Rode o SQL exibido no topo da aba e tente de novo.',
                'alerta'
            );
        };

        async function requisitarRotacao(corpo) {
            const res = await fetch(`/api/admin/url-rotations?token=${encodeURIComponent(currentModToken)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(corpo)
            });
            const data = await res.json().catch(() => ({}));
            return { res, data };
        }

        const linhasDeResultadoIndividual = (resultados) => resultados.map((r) => `
            <p class="font-medium">URL rotacionada com sucesso${r.lang === 'en' ? ' (inglês)' : ''}</p>
            <p class="font-mono text-[11px] text-white">Nova URL: <a href="${r.fullUrl}" target="_blank" class="underline text-emerald-300">${window.location.origin}${r.fullUrl}</a></p>
        `).join('');

        async function handleSingleRotation() {
            if (!currentModToken) return;
            const inputEl = document.getElementById('rot-input-url');
            const customSlugEl = document.getElementById('rot-custom-slug');
            const forcedTypeEl = document.getElementById('rot-forced-type');
            const submitBtn = document.getElementById('btn-submit-rotation');
            const spinner = document.getElementById('rot-single-spinner');

            const input = inputEl?.value?.trim();
            const customSlug = customSlugEl?.value?.trim() || undefined;
            const forcedType = forcedTypeEl?.value || undefined;
            if (!input) return;

            if (submitBtn) submitBtn.disabled = true;
            if (spinner) spinner.classList.remove('hidden');

            const resultados = [];
            const falhas = [];
            try {
                for (const lang of idiomasDaSelecao('rot-lang')) {
                    const { res, data } = await requisitarRotacao({ input, customSlug, forcedType, lang });
                    if (data?.needMigration) return tratarMigracaoPendente(data);
                    if (res.ok && data.success) resultados.push(data.result);
                    else falhas.push(data?.error || 'Erro desconhecido');
                }

                if (resultados.length === 0) {
                    mostrarFeedbackRotacao(`Erro ao rotacionar: ${escapeHtml(falhas.join('; '))}`, 'erro');
                    return;
                }

                const avisoFalhas = falhas.length
                    ? `<p class="text-[10px] text-amber-400">${escapeHtml(falhas.join('; '))}</p>`
                    : '';
                mostrarFeedbackRotacao(
                    linhasDeResultadoIndividual(resultados) +
                    avisoFalhas +
                    '<p class="text-[10px] text-gray-400">Você já pode enviar esta nova URL ao Search Console do Google para indexação imediata.</p>',
                    falhas.length ? 'alerta' : 'ok'
                );
                if (inputEl) inputEl.value = '';
                if (customSlugEl) customSlugEl.value = '';
                fetchUrlRotations();
            } catch (err) {
                mostrarFeedbackRotacao(`Falha na conexão com o servidor: ${escapeHtml(err.message)}`, 'erro');
            } finally {
                if (submitBtn) submitBtn.disabled = false;
                if (spinner) spinner.classList.add('hidden');
            }
        }

        async function handleBatchRotation() {
            if (!currentModToken) return;
            const textarea = document.getElementById('rot-batch-input');
            const submitBtn = document.getElementById('btn-submit-batch');
            const spinner = document.getElementById('rot-batch-spinner');

            const text = textarea?.value?.trim();
            if (!text) return;

            const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
            if (lines.length === 0) return;

            if (submitBtn) submitBtn.disabled = true;
            if (spinner) spinner.classList.remove('hidden');

            let rotacionadas = 0;
            let total = 0;
            const erros = [];
            try {
                for (const lang of idiomasDaSelecao('rot-batch-lang')) {
                    const { res, data } = await requisitarRotacao({ batch: lines, lang });
                    if (data?.needMigration) return tratarMigracaoPendente(data);
                    if (res.ok && data.success) {
                        rotacionadas += data.rotated || 0;
                        total += data.total || 0;
                        erros.push(...(data.errors || []));
                        continue;
                    }
                    erros.push({ input: '(lote)', error: data?.error || 'Erro desconhecido' });
                }

                mostrarFeedbackRotacao(
                    `<p class="font-medium">Lote processado: ${rotacionadas} de ${total} rotações aplicadas</p>` +
                    (erros.length
                        ? `<p class="text-amber-400">${erros.length} falharam (verifique os slugs): <span class="font-mono">${escapeHtml(erros.slice(0, 3).map(e => `${e.input} — ${e.error}`).join('; '))}</span></p>`
                        : ''),
                    erros.length ? 'alerta' : 'ok'
                );
                textarea.value = '';
                fetchUrlRotations();
            } catch (err) {
                mostrarFeedbackRotacao(`Falha ao processar lote: ${escapeHtml(err.message)}`, 'erro');
            } finally {
                if (submitBtn) submitBtn.disabled = false;
                if (spinner) spinner.classList.add('hidden');
            }
        }

        async function handleDeleteRotation(id) {
            if (!currentModToken || !id) return;
            try {
                const res = await fetch(`/api/admin/url-rotations?token=${encodeURIComponent(currentModToken)}`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id })
                });
                if (res.ok) {
                    fetchUrlRotations();
                } else {
                    const data = await res.json().catch(() => ({}));
                    alert(`Erro ao remover: ${data.error || 'Desconhecido'}`);
                }
            } catch (e) {
                alert(`Erro de conexão ao remover rotação: ${e.message}`);
            }
        }

        async function handleClearAllRotations() {
            if (!currentModToken) return;
            try {
                const res = await fetch(`/api/admin/url-rotations?token=${encodeURIComponent(currentModToken)}`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ clearAll: true })
                });
                if (res.ok) {
                    alert("Todas as rotações foram limpas! ✨");
                    fetchUrlRotations();
                } else {
                    const data = await res.json().catch(() => ({}));
                    alert(`Erro ao limpar: ${data.error || 'Desconhecido'}`);
                }
            } catch (e) {
                alert(`Erro de conexão: ${e.message}`);
            }
        }

    }

    document.addEventListener('astro:page-load', initModeracao);
