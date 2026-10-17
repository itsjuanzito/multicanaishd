// Self-destruct: este era o worker do push da Monetag (removido por 'Paginas enganosas' no
// Google). Mantido so pra navegadores que ainda o tem registrado baixarem esta versao,
// se desregistrarem e limparem os caches. Nao reutilizar.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        try {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
        } catch (e) {}
        await self.registration.unregister();
        const clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach((c) => c.navigate(c.url).catch(() => {}));
    })());
});
