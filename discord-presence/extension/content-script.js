function toAbsoluteUrl(maybeUrl) {
  if (!maybeUrl) return null;

  // Algumas fontes de "jogos ao vivo" retornam URLs de imagem malformadas,
  // com uma segunda URL embutida sem encoding e sem espaço entre elas
  // (ex: cloudfront.net/https://superflixapi.pro/img/x.png). Como não há
  // separador, pega a partir da ÚLTIMA ocorrência literal de "http(s)://".
  let candidate = maybeUrl;
  const schemeMatches = [...maybeUrl.matchAll(/https?:\/\//g)];
  if (schemeMatches.length > 1) {
    const lastScheme = schemeMatches[schemeMatches.length - 1];
    candidate = maybeUrl.slice(lastScheme.index);
  }

  // imgur.com/x.png é a página HTML de visualização, não a imagem crua;
  // i.imgur.com/x.png é o link direto da imagem.
  candidate = candidate.replace(/^https?:\/\/imgur\.com\//, "https://i.imgur.com/");

  try {
    const url = new URL(candidate, window.location.origin);
    if (!/\.(png|jpe?g|webp|gif|avif)$/i.test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function readDataLayer() {
  const el = document.getElementById("slug-data-layer");
  if (el) return el.dataset;

  const channelEl = document.querySelector("main[data-channel-id]");
  if (channelEl) return channelEl.dataset;

  return null;
}

function findCurrentEpisode(dataset) {
  if (!dataset.initialEpisodes) return null;
  try {
    const episodes = JSON.parse(dataset.initialEpisodes);
    const episodeNumber = Number(dataset.episode);
    const match = episodes.find((ep) => ep.episode_number === episodeNumber);
    if (!match) return null;
    return {
      still: match.still_path ? `https://image.tmdb.org/t/p/w500${match.still_path}` : null,
      overview: match.overview || null,
    };
  } catch {
    return null;
  }
}

function detectActivity() {
  const path = window.location.pathname;
  const url = window.location.href;
  const dataset = readDataLayer();

  if (dataset && path.includes("/canal/")) {
    return {
      type: "live",
      title: dataset.title,
      poster: toAbsoluteUrl(dataset.image),
      url,
    };
  }

  if (dataset && path.includes("/serie/")) {
    const currentEpisode = findCurrentEpisode(dataset);
    return {
      type: "tv",
      title: dataset.title,
      season: dataset.season,
      episode: dataset.episode,
      poster: currentEpisode?.still || toAbsoluteUrl(dataset.poster),
      overview: currentEpisode?.overview,
      url,
    };
  }

  if (dataset && path.includes("/filme/")) {
    return {
      type: "movie",
      title: dataset.title,
      poster: toAbsoluteUrl(dataset.poster),
      url,
    };
  }

  return {
    type: "browsing",
    url: window.location.origin + "/",
  };
}

let lastSent = null;
let startedAt = null;

function isExtensionContextValid() {
  return Boolean(chrome.runtime?.id);
}

function safeSendMessage(message) {
  if (!isExtensionContextValid()) {
    stopWatching();
    return;
  }
  try {
    chrome.runtime.sendMessage(message);
  } catch {
    stopWatching();
  }
}

function sendActivity() {
  if (!isExtensionContextValid()) {
    stopWatching();
    return;
  }

  const activity = detectActivity();
  const key = JSON.stringify(activity);

  if (key === lastSent) return;
  lastSent = key;

  startedAt = Math.floor(Date.now() / 1000);

  safeSendMessage({
    action: "update",
    ...activity,
    startedAt,
  });
}

function stopWatching() {
  observer.disconnect();
  clearInterval(pollTimer);
}

const observer = new MutationObserver(() => sendActivity());
observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });

// Rede de segurança: o Astro View Transitions troca o DOM via soft navigation e,
// dependendo de como a troca acontece, o MutationObserver pode não pegar a mudança.
const pollTimer = setInterval(sendActivity, 2000);

sendActivity();

document.addEventListener("astro:page-load", sendActivity);
document.addEventListener("astro:after-swap", sendActivity);

window.addEventListener("beforeunload", () => {
  safeSendMessage({ action: "clear" });
});
