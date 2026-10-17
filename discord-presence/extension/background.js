const WS_URL = "ws://127.0.0.1:32172";

let socket = null;
let reconnectTimer = null;

function connect() {
  socket = new WebSocket(WS_URL);

  socket.addEventListener("close", scheduleReconnect);
  socket.addEventListener("error", () => socket?.close());
}

function scheduleReconnect() {
  socket = null;
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 3000);
}

function send(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    connect();
    return;
  }
  try {
    socket.send(JSON.stringify(message));
  } catch {
    scheduleReconnect();
  }
}

connect();

chrome.runtime.onMessage.addListener((message) => {
  send(message);
});

chrome.tabs.onRemoved.addListener(() => {
  send({ action: "clear" });
});
