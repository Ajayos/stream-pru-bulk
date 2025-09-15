const http = require("http");
const WebSocket = require("ws");
const express = require("express");
const os = require("os");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static("public"));
app.use(express.json());

// =====================
// Data Stores
// =====================
/** @type {Map<string, { id: string, name: string, call_id?: string, cli?: string, dni?: string, media_format?: object, custom_parameters?: any[], ws: WebSocket, listeners: Set<WebSocket> }>} */
const streams = new Map();
/** @type {Map<WebSocket, { id: string, name: string }>} */
const users = new Map();

// =====================
// Helpers
// =====================
function sendSafe(ws, data) {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  } catch (err) {
    console.error("Send error:", err.message);
  }
}

function broadcast(data, exceptWs = null) {
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client !== exceptWs) {
      sendSafe(client, data);
    }
  }
}

function authenticate(req) {
  const authHeader = req.headers["authorization"] || "";
  const url_auth = req.url || "";

  // Query param check
  if (url_auth.includes("?")) {
    const [, query] = url_auth.split("?");
    const [key, value] = query.split("=");
    if (key === "ptpl" && value === "Ptpl123") return true;
  }

  // Basic auth
  if (authHeader.startsWith("Basic ")) return true;

  // Bearer auth
  if (authHeader.startsWith("Bearer ")) return true;

  console.log("Fallback auth headers:", req.headers);
  return true; // currently allow all
}

// =====================
// WebSocket Handling
// =====================
wss.on("connection", (ws, req) => {
  if (!authenticate(req)) {
    sendSafe(ws, { event: "error", message: "Unauthorized" });
    ws.close();
    return;
  }

  console.log("Client connected");

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const event = String(msg?.event || "").toLowerCase();

    switch (event) {
      case "start":
        handleStart(ws, msg);
        break;
      case "stop":
        handleStop(ws, msg);
        break;
      case "register-user":
        handleRegisterUser(ws, msg);
        break;
      case "join-room":
        handleJoinRoom(ws, msg);
        break;
      case "leave-room":
        handleLeaveRoom(ws, msg);
        break;
      case "media":
        handleMedia(ws, msg);
        break;
      case "dtmf":
        sendToAllListeners(ws, msg);
        break;
      case "audio":
        sendToStream(ws, msg, { event: "media" });
        break;
      case "clear":
        sendToStream(ws, msg);
        break;
      case "mark":
        sendToStream(ws, msg);
        break;
      default:
        sendToAllListeners(ws, msg);
        console.log("Unknown event:", event);
    }
  });

  ws.on("close", () => handleDisconnect(ws));
  ws.on("error", (err) => {
    console.error("WebSocket error:", err.message);
  });
});

// =====================
// Event Handlers
// =====================
function handleStart(ws, msg) {
  const {
    call_id,
    room_id,
    cli,
    dni,
    media_format = {},
    custom_parameters = [],
  } = msg.start || {};
  if (!room_id) return;

  const room = {
    id: room_id,
    name: room_id,
    call_id,
    cli,
    dni,
    media_format,
    custom_parameters,
    ws,
    listeners: new Set([ws]),
  };

  streams.set(room_id, room);

  broadcast(
    {
      event: "add-stream",
      stream: [{ name: room_id, room_id, call_id, cli, dni }],
    },
    ws
  );

  console.log(`Stream started: ${room_id}`);
}

function handleStop(ws, msg) {
  const room_id = msg?.room_id;
  if (!room_id) return;

  if (streams.has(room_id)) {
    streams.delete(room_id);
    broadcast(
      { event: "remove-stream", room_id, reason: msg?.stop?.reason, data: msg },
      ws
    );
    console.log(`Stream stopped: ${room_id}`);
  }
}

function handleRegisterUser(ws, msg) {
  const { id, name } = msg;
  if (!id || !name) return;

  users.set(ws, { id, name });

  const streamList = [...streams.values()].map((s) => ({
    id: s.id,
    name: s.name,
  }));
  sendSafe(ws, { event: "add-stream", stream: streamList });

  console.log(`User registered: ${id} (${name})`);
}

function handleJoinRoom(ws, msg) {
  const { room_id } = msg;
  if (!room_id || !streams.has(room_id)) return;

  // remove from all other listeners
  for (const room of streams.values()) {
    room.listeners.delete(ws);
  }

  const room = streams.get(room_id);
  room.listeners.add(ws);
  sendSafe(ws, { event: "joined-room", room_id });

  console.log(`User joined room: ${room_id}`);
}

function handleLeaveRoom(ws, msg) {
  const { room_id } = msg;
  if (!room_id || !streams.has(room_id)) return;

  streams.get(room_id).listeners.delete(ws);
  sendSafe(ws, { event: "left-room", room_id });

  console.log(`User left room: ${room_id}`);
}

function sendToAllListeners(ws, msg, config = {}) {
  const { room_id } = msg;
  if (!room_id || !streams.has(room_id)) return;

  const room = streams.get(room_id);
  for (const listener of room.listeners) {
    if (listener !== ws) sendSafe(listener, { ...msg, ...config });
  }
}

function sendToStream(ws, msg, config = {}) {
  const { room_id } = msg;
  if (!room_id || !streams.has(room_id)) return;

  const room = streams.get(room_id);

  // if the mark send by the ws then no send to itself
  if (ws === room.ws) return broadcast(msg, ws);

  sendSafe(room.ws, { ...msg, ...config });
}

function handleMedia(ws, msg) {
  const { room_id } = msg;
  if (!room_id || !streams.has(room_id)) return;

  const room = streams.get(room_id);
  for (const listener of room.listeners) {
    if (listener !== ws)
      sendSafe(listener, {
        ...msg,
        media_format: room.media_format,
      });
  }
}

function handleDisconnect(ws) {
  console.log("Client disconnected");

  users.delete(ws);

  for (const [room_id, room] of streams.entries()) {
    room.listeners.delete(ws);

    // if its a publisher then delete the room
    if (room.ws === ws) {
      streams.delete(room_id);
      broadcast({
        event: "remove-stream",
        room_id,
        reason: "Stream disconnected",
        data: {},
      });
      console.log(`Room destroyed: ${room_id}`);
    }
  }
}

// =====================
// Health Check (publisher alive)
// =====================
setInterval(() => {
  for (const [room_id, room] of streams.entries()) {
    if (room.ws.readyState !== WebSocket.OPEN) {
      console.log(`Publisher dead for room ${room_id}, cleaning up`);
      streams.delete(room_id);
      broadcast({
        event: "remove-stream",
        room_id,
        reason: "Stream dead",
        data: {},

        stream: [{ room_id }],
      });
    }
  }
}, 5000);

// =====================
// Server
// =====================
const PORT = 3031;
server.listen(PORT, () => {
  const ip = Object.values(os.networkInterfaces())
    .flat()
    .map((x) => x.address)
    .filter((ip) => ip && ip.includes("."));
  ip.forEach((ip) =>
    console.log(`HTTP Server running on http://${ip}:${PORT}`)
  );
});
