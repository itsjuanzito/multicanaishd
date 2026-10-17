# Setup do MultiCanaisHD

Clonado do betterflix. O **código** está completo (build limpo, 261 testes); o que
falta é infraestrutura e contas — nada disso se resolve por código.

## 1. Domínio — $(System.Collections.Hashtable.dom)
- Registrado na Porkbun. Apontar os NS para a Cloudflare
  (rady.ns.cloudflare.com, zelda.ns.cloudflare.com).
- Anexar $(System.Collections.Hashtable.dom) e www.multicanaishd.lol ao projeto Pages $(System.Collections.Hashtable.slug).

## 2. Cloudflare Pages
- Criar o projeto $(System.Collections.Hashtable.slug) (este repositório já declara o binding em
  rontend/wrangler.toml; o KV SESSION é $(System.Collections.Hashtable.kv)).
- Segredos/variáveis a configurar (não versionados):
  SITE_URL, CRON_SECRET, ADMIN_MODERATION_TOKEN, KEY_API_TMDB,
  PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
  REDIS_URL, STREAMBETTER_API_KEY, STREAMBETTER_EMBED_PUBLIC_KEY,
  STREAMBETTER_SHOP_URL, VELORAPAY_API_KEY, VELORAPAY_API_SECRET,
  VELORAPAY_WEBHOOK_SECRET, CLOUDFLARE_ANALYTICS_TOKEN.
  Opcional: PUBLIC_DISQUS_SHORTNAME, AXIOM_DATASET.

## 3. Verificação de domínio
As tags do projeto de origem foram **removidas de propósito** (verificação é por
propriedade — copiar não verifica nada e esconde que o domínio não está verificado).
- Google: verificar por **DNS TXT** (cobre o domínio inteiro).
- ProfitOn: token emitido PARA este domínio; adicionar a tag em
  rontend/src/pages/components/SEO.astro.

## 4. Anúncios — PENDENTE E OBRIGATÓRIO
rontend/src/services/adSettings.js ainda contém as zonas do betterflix.
**Publicar assim manda a receita para a conta dele.** Trocar smartlink, popunder,
social bar e banners pelas zonas deste domínio antes de subir.

## 5. Cron
Em cron-worker/: wrangler deploy e wrangler secret put CRON_SECRET.
O SITE_URL e o KV já estão no wrangler.toml deste diretório.

## 6. Banco de dados
Compartilha o mesmo Supabase do betterflix e do redecanais (decisão do dono).
Consequência a ter em mente: url_rotations é **comum aos cinco sites**, então a
rotação anti-DMCA automática de um muda a URL canônica dos outros. Se um dia isso
incomodar, o caminho é uma coluna de site na tabela.

## 7. Domínio legado
HOSTS_LEGADOS está **vazio** — este projeto ainda não tem domínio antigo.
Ao migrar de domínio no futuro: acrescentar o domínio de saída nessa lista
**antes** de trocar o SITE_URL, senão os dois servem o mesmo conteúdo em paralelo.