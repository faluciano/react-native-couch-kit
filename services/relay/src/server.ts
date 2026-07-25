/**
 * Couch Kit relay server (Bun-native, zero runtime dependencies).
 *
 * A small, game-agnostic WebSocket relay: hosts create rooms, phones join them,
 * and JSON envelopes are routed between them by {@link RelayRooms}. Deploy one
 * instance and point every game's display + phones at it (see README).
 */
import { RelayRooms, type RelayConnection } from "./rooms";

interface SocketData {
  id: string;
  ip: string;
  conn: RelayConnection | null;
}

const rooms = new RelayRooms();
const port = Number(process.env.PORT ?? 8787);

/**
 * Optional origin allowlist. Set `ALLOWED_ORIGINS` (comma-separated) to reject
 * WebSocket upgrades from other origins; unset means allow any origin (the
 * default, since displays run on varying Vercel URLs).
 */
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

/** Max concurrent connections per client IP (socket-exhaustion bound). */
const maxConnectionsPerIp = Number(process.env.MAX_CONNECTIONS_PER_IP ?? 50);

/** Live connection count per IP, used to cap concurrent sockets. */
const ipCounts = new Map<string, number>();

function originAllowed(req: Request): boolean {
  if (allowedOrigins.length === 0) return true;
  const origin = req.headers.get("origin");
  return origin !== null && allowedOrigins.includes(origin);
}

const server = Bun.serve<SocketData, undefined>({
  port,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/healthz") {
      return new Response("ok", { status: 200 });
    }

    if (!originAllowed(req)) {
      return new Response("Forbidden origin", { status: 403 });
    }

    const ip = server.requestIP(req)?.address ?? "unknown";
    if ((ipCounts.get(ip) ?? 0) >= maxConnectionsPerIp) {
      return new Response("Too many connections", { status: 429 });
    }

    const upgraded = server.upgrade(req, {
      data: { id: crypto.randomUUID(), ip, conn: null },
    });
    if (upgraded) return undefined;
    return new Response("Couch Kit relay", { status: 200 });
  },
  websocket: {
    maxPayloadLength: 512 * 1024,
    open(ws) {
      ipCounts.set(ws.data.ip, (ipCounts.get(ws.data.ip) ?? 0) + 1);
      ws.data.conn = { id: ws.data.id, send: (data: string) => ws.send(data) };
    },
    message(ws, message) {
      if (!ws.data.conn) return;
      const keepOpen = rooms.handleMessage(
        ws.data.conn,
        typeof message === "string" ? message : message.toString(),
      );
      // A connection that trips the rate limit is dropped to shed abusive load.
      if (!keepOpen) ws.close(1008, "Rate limited");
    },
    close(ws) {
      const next = (ipCounts.get(ws.data.ip) ?? 1) - 1;
      if (next <= 0) ipCounts.delete(ws.data.ip);
      else ipCounts.set(ws.data.ip, next);
      if (ws.data.conn) rooms.handleClose(ws.data.conn);
    },
  },
});

console.log(`Couch Kit relay listening on :${server.port}`);
