import asyncio
import sys
import json
from playwright.async_api import async_playwright

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        logs = []
        page.on("console", lambda msg: logs.append(f"[CONSOLE] [{msg.type}] {msg.text}"))
        page.on("pageerror", lambda err: logs.append(f"[PAGEERROR] {err.message}"))

        # Injetar o mock do Supabase
        mock_js = """
        globalThis._supabase = {
            auth: {
                getSession: () => Promise.resolve({ 
                    data: { 
                        session: { 
                            user: { id: "e2c34d56-fb9e-4b2a-89a3-5c21f016abcf", email: "teste@betterflix.com" } 
                        } 
                    }, 
                    error: null 
                }),
                onAuthStateChange: (cb) => {
                    setTimeout(() => {
                        cb("INITIAL_SESSION", { 
                            user: { id: "e2c34d56-fb9e-4b2a-89a3-5c21f016abcf", email: "teste@betterflix.com" } 
                        });
                    }, 50);
                    return { data: { subscription: { unsubscribe: () => {} } } };
                }
            },
            channel: (name, config) => {
                console.log("[MOCK SUPABASE] channel() chamado para: " + name);
                return {
                    name: name,
                    topic: name,
                    on: (event, filter, callback) => {
                        console.log("[MOCK SUPABASE] channel.on() chamado para evento: " + event);
                    },
                    subscribe: (cb) => {
                        console.log("[MOCK SUPABASE] channel.subscribe() chamado.");
                        if (cb) setTimeout(() => cb("SUBSCRIBED"), 10);
                    },
                    track: (state) => {
                        console.log("[MOCK SUPABASE] channel.track() chamado com state: " + JSON.stringify(state));
                        return Promise.resolve();
                    },
                    presenceState: () => ({}),
                    send: (payload) => {
                        console.log("[MOCK SUPABASE] channel.send() chamado com: " + JSON.stringify(payload));
                    }
                };
            },
            getChannels: () => {
                console.log("[MOCK SUPABASE] getChannels() chamado.");
                return [];
            },
            removeChannel: (c) => {
                console.log("[MOCK SUPABASE] removeChannel() chamado.");
            }
        };
        """
        await page.add_init_script(mock_js)

        # 1. Carrega Home e injeta mock auth
        await page.goto("http://localhost:4321/")
        session_mock = {
            "user": {
                "id": "e2c34d56-fb9e-4b2a-89a3-5c21f016abcf",
                "email": "teste@betterflix.com"
            },
            "token": "mock-token",
            "isVIP": True,
            "vipUntil": None,
            "vipPlan": "vitalicio",
            "favorites": [],
            "history": [],
            "watchedMovies": [],
            "watchedEpisodes": {},
            "username": "User Teste",
            "avatar": "3",
            "activeSeconds": 5000,
            "initialized": True,
            "loading": False
        }
        await page.evaluate(f"localStorage.setItem('bf_session_optimistic', '{json.dumps(session_mock)}');")

        # 2. Vai para o Dashboard
        logs.append("=== NAVEGANDO PARA O DASHBOARD ===")
        await page.goto("http://localhost:4321/watchparty")
        await page.wait_for_timeout(2000)

        # 3. TRANSICAO 1: Dashboard -> Sala A&E
        logs.append("=== TRANSICAO 1: CLICK A&E ===")
        btn = page.locator("a[href*='/watchparty/ae']").first
        await btn.click()
        await page.wait_for_timeout(3000)

        # 4. TRANSICAO 2: Sala A&E -> Dashboard
        logs.append("=== TRANSICAO 2: VOLTAR DASHBOARD ===")
        # Clica no link "Watch Party" do header para voltar para o dashboard
        dash_link = page.locator("header a:has-text('Watch Party')").first
        await dash_link.click()
        await page.wait_for_timeout(3000)

        # 5. TRANSICAO 3: Dashboard -> Sala A&E novamente
        logs.append("=== TRANSICAO 3: CLICK A&E NOVAMENTE ===")
        btn2 = page.locator("a[href*='/watchparty/ae']").first
        await btn2.click()
        await page.wait_for_timeout(3000)

        await browser.close()

        # Escreve logs para debug_output.log
        with open("debug_output.log", "w", encoding="utf-8") as f:
            for log in logs:
                f.write(log + "\n")

        print("=== LOGS GRAVADOS COM SUCESSO EM debug_output.log ===")

if __name__ == "__main__":
    asyncio.run(run())
