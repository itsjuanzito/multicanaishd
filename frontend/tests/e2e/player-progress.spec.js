import { test, expect } from '@playwright/test';

const seed = (history) => {
    return (h) => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        localStorage.setItem('bf_session_optimistic', JSON.stringify({
            user: { id: 'test-user-id', email: 'test@test.com' },
            token: 'fake-token', isVIP: true, vipUntil: '2099-01-01', vipPlan: 'diamond',
            favorites: [], history: h, watchedMovies: [], watchedEpisodes: {},
            username: 'tester', avatar: '1'
        }));
    };
};

test('filme: start= retoma e ended marca assistido', async ({ page, context }) => {
    // Deixa as chamadas do Supabase penduradas: o check real invalidaria a sessao falsa e
    // limparia user/history, o que nao tem relacao com o que este teste verifica. Assim o
    // snapshot otimista sobrevive (o authStore libera a UI pelo timeout de 7s dele).
    await page.route(/supabase/, () => { /* nunca resolve */ });

    await context.addInitScript(seed(), [{
        id: '1061474', title: 'Superman', type: 'movie', url: '/filme/1061474-superman',
        timestamp: Date.now(), resume_seconds: 1800, duration_seconds: 7200
    }]);

    await page.goto('http://localhost:4321/filme/1061474-superman', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.BetterPlayer?.state?.initialized === true, null, { timeout: 40000 });

    const startUrl = await page.evaluate(() => document.getElementById('playerFrame')?.getAttribute('src'));

    // Progresso avança -> src NAO pode recarregar sozinho (start fora da comparacao)
    await page.evaluate(() => window.BetterPlayer.onPlayerProgress({ type: 'streambetter:progress', tmdbId: 1061474, season: null, episode: null, currentTime: 2400, duration: 7200, state: 'playing' }));
    await page.waitForTimeout(300);
    await page.evaluate(() => window.BetterPlayer.updateVIPUI());
    await page.waitForTimeout(200);
    const afterProgressUrl = await page.evaluate(() => document.getElementById('playerFrame')?.getAttribute('src'));

    // tmdbId de outro conteudo -> ignorado
    await page.evaluate(() => window.BetterPlayer.onPlayerProgress({ tmdbId: 999999, currentTime: 10, duration: 20, state: 'playing' }));
    await page.waitForTimeout(200);
    const afterWrongId = await page.evaluate(() => window.BetterPlayer._progress.currentTime);

    // ended -> marca assistido e zera resume
    await page.evaluate(() => window.BetterPlayer.onPlayerProgress({ tmdbId: 1061474, currentTime: 7190, duration: 7200, state: 'ended' }));
    await page.waitForTimeout(500);
    const ended = await page.evaluate(() => {
        const s = window._authStore?.get();
        const h = s?.history?.find(i => String(i.id) === '1061474');
        return { watched: (s?.watchedMovies || []).includes('1061474'), resume: h?.resume_seconds };
    });

    console.log('FILME ' + JSON.stringify({
        start: (startUrl || '').match(/start=\d+/)?.[0] || null,
        recarregou: startUrl !== afterProgressUrl,
        afterWrongId, ended
    }));

    expect((startUrl || '')).toContain('start=1800');
    expect(startUrl, 'progresso nao pode recarregar o iframe').toBe(afterProgressUrl);
    expect(afterWrongId, 'tmdbId de outro conteudo ignorado').toBe(2400);
    expect(ended.watched, 'ended marca assistido').toBe(true);
    expect(ended.resume, 'ended zera o resume').toBe(0);
});

test('serie: autoplay sincroniza episodio sem recarregar iframe', async ({ page, context }) => {
    await page.route(/supabase/, () => { /* nunca resolve — ver comentario no teste acima */ });

    await context.addInitScript(seed(), []);

    await page.goto('http://localhost:4321/serie/125988-silo?season=1&episode=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.BetterPlayer?.state?.initialized === true, null, { timeout: 40000 });

    const srcBefore = await page.evaluate(() => document.getElementById('playerFrame')?.getAttribute('src'));

    // Player avanca sozinho pro ep2 e reporta progresso ja como ep2
    await page.evaluate(() => window.BetterPlayer.onPlayerProgress({ type: 'streambetter:progress', tmdbId: 125988, season: 1, episode: 2, currentTime: 120, duration: 2700, state: 'playing' }));
    await page.waitForTimeout(500);
    // updateVIPUI roda a cada mudanca do authStore; nao pode recarregar o iframe
    await page.evaluate(() => window.BetterPlayer.updateVIPUI());
    await page.waitForTimeout(300);

    const depois = await page.evaluate(() => {
        const h = window._authStore?.get()?.history?.find(i => String(i.id) === '125988');
        return {
            src: document.getElementById('playerFrame')?.getAttribute('src'),
            stateEp: window.BetterPlayer.state.episodeNum,
            urlEp: new URL(window.location.href).searchParams.get('episode'),
            hist: h ? { s: h.resume_season, e: h.resume_episode, resume: h.resume_seconds } : null,
        };
    });

    console.log('SERIE ' + JSON.stringify({ recarregou: srcBefore !== depois.src, ...depois }));

    expect(depois.src, 'autoplay nao pode recarregar o iframe').toBe(srcBefore);
    expect(String(depois.stateEp), 'estado seguiu o player').toBe('2');
    expect(depois.urlEp, 'URL da pagina seguiu o player').toBe('2');
    expect(String(depois.hist?.e), 'progresso carimbado no ep2').toBe('2');
    expect(depois.hist?.resume).toBe(120);
});
