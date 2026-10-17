const os = require("os");
const { execSync } = require("child_process");
const WebSocket = require("ws");
const RPC = require("discord-rpc");

const DISCORD_CLIENT_ID = "1526692380009304256";
const PORT = 32172;
const AUTOSTART_NAME = "MultiCanaisHDDiscordPresence";

registerAutoStart();

const client = new RPC.Client({ transport: "ipc" });
let ready = false;

client.on("ready", () => {
  ready = true;
});

client.login({ clientId: DISCORD_CLIENT_ID }).catch(() => {
  // Discord Desktop fechado ou indisponível — a extensão simplesmente não terá presence.
});

function registerAutoStart() {
  if (os.platform() !== "win32") return;
  try {
    const exePath = process.pkg ? process.execPath : `node "${__filename}"`;
    const registryKey = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run`;
    execSync(`reg add "${registryKey}" /v "${AUTOSTART_NAME}" /t REG_SZ /d "cmd /c start /min \\"\\" \\"${exePath}\\"" /f`);
  } catch {
    // Sem permissão ou ambiente restrito — segue sem autostart, usuário precisa abrir manualmente.
  }
}

function truncate(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function activityFromPayload(payload) {
  if (payload.type === "browsing") {
    return {
      largeImageKey: "multicanaishd_logo",
      largeImageText: "MultiCanaisHD",
      details: "Navegando no site",
      instance: false,
      startTimestamp: payload.startedAt,
      buttons: payload.url ? [{ label: "Abrir MultiCanaisHD", url: payload.url }] : undefined,
    };
  }

  const base = {
    largeImageKey: payload.poster || "multicanaishd_logo",
    largeImageText: payload.title,
    smallImageKey: payload.type === "live" ? "live" : payload.type === "tv" ? "tv" : "movie",
    smallImageText: "MultiCanaisHD",
    instance: false,
    buttons: payload.url ? [{ label: "Assistir no MultiCanaisHD", url: payload.url }] : undefined,
  };

  if (payload.type === "movie") {
    return {
      ...base,
      details: payload.title,
      state: "Assistindo filme",
      startTimestamp: payload.startedAt,
    };
  }

  if (payload.type === "tv") {
    const episodeLabel = `T${payload.season} · E${payload.episode}`;
    const state = payload.overview ? `${episodeLabel} — ${truncate(payload.overview, 128 - episodeLabel.length - 3)}` : episodeLabel;
    return {
      ...base,
      details: payload.title,
      state,
      startTimestamp: payload.startedAt,
    };
  }

  if (payload.type === "live") {
    return {
      ...base,
      details: payload.title,
      state: "Assistindo ao vivo",
      startTimestamp: payload.startedAt,
    };
  }

  return null;
}

async function handleMessage(payload) {
  if (!ready) return;

  if (payload.action === "clear") {
    await client.clearActivity().catch(() => {});
    return;
  }

  if (payload.action === "update") {
    const activity = activityFromPayload(payload);
    if (activity) {
      await client.setActivity(activity).catch(() => {});
    }
  }
}

const wss = new WebSocket.Server({ host: "127.0.0.1", port: PORT });

wss.on("connection", (socket) => {
  socket.on("message", (raw) => {
    try {
      const payload = JSON.parse(raw.toString());
      handleMessage(payload);
    } catch {
      // Mensagem inválida, ignora.
    }
  });
});
