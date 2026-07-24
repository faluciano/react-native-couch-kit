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
  conn: RelayConnection | null;
}

const rooms = new RelayRooms();
const port = Number(process.env.PORT ?? 8787);

const server = Bun.serve<SocketData, undefined>({
  port,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/healthz") {
      return new Response("ok", { status: 200 });
    }
    const upgraded = server.upgrade(req, {
      data: { id: crypto.randomUUID(), conn: null },
    });
    if (upgraded) return undefined;
    return new Response("Couch Kit relay", { status: 200 });
  },
  websocket: {
    maxPayloadLength: 512 * 1024,
    open(ws) {
      ws.data.conn = { id: ws.data.id, send: (data: string) => ws.send(data) };
    },
    message(ws, message) {
      if (!ws.data.conn) return;
      rooms.handleMessage(
        ws.data.conn,
        typeof message === "string" ? message : message.toString(),
      );
    },
    close(ws) {
      if (ws.data.conn) rooms.handleClose(ws.data.conn);
    },
  },
});

console.log(`Couch Kit relay listening on :${server.port}`);
