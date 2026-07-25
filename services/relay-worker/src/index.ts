/**
 * Game-agnostic Couch Kit relay, on Cloudflare Workers + Durable Objects.
 *
 * The Worker is a router and nothing else: it validates the request and hands
 * the socket to the Durable Object that owns that room code. All routing lives
 * in the DO (see `room.ts`), which shares its core with the Bun relay.
 *
 * Unlike the single-container relay, room codes address separate objects, so
 * there is no global room table, no single-replica constraint, and no way for
 * two rooms to interfere with each other.
 */

export { RelayRoom } from "./room";

export interface Env {
  ROOMS: DurableObjectNamespace;
  /** Optional comma-separated origin allowlist. Empty/unset = open. */
  ALLOWED_ORIGINS?: string;
}

/**
 * Room codes address Durable Objects, so keep them to a conservative shape:
 * short and alphanumeric. This bounds what a hostile client can name into
 * existence and keeps codes case-insensitive for people typing them off a TV.
 */
const ROOM_CODE = /^[A-Z0-9]{1,16}$/;

function originAllowed(request: Request, env: Env): boolean {
  const allowed = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  if (allowed.length === 0) return true;
  const origin = request.headers.get("Origin");
  return origin !== null && allowed.includes(origin);
}

/** Room code from `/r/CODE`, falling back to `?room=CODE`. */
function roomCodeFrom(url: URL): string | null {
  const path = url.pathname.split("/").filter(Boolean);
  const fromPath = path[0] === "r" ? path[1] : undefined;
  const code = (fromPath ?? url.searchParams.get("room") ?? "").toUpperCase();
  return ROOM_CODE.test(code) ? code : null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return new Response("ok", { status: 200 });
    }

    if (!originAllowed(request, env)) {
      return new Response("Forbidden origin", { status: 403 });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Couch Kit relay", { status: 200 });
    }

    const code = roomCodeFrom(url);
    if (code === null) {
      return new Response("Missing or invalid room code", { status: 400 });
    }

    // idFromName maps a room code to a stable object. The object exists
    // whether or not a display has created the room yet; an early joiner just
    // gets ROOM_NOT_FOUND from the empty room, exactly as before.
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    return stub.fetch(request);
  },
};
