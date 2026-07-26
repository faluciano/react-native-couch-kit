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

import { generateRoomCode } from "../../relay/src/rooms";
import { ASSIGNED_CODE_HEADER } from "./room";

export { RelayRoom } from "./room";

/** Cloudflare's rate-limiting binding (see `unsafe.bindings` in wrangler.jsonc). */
interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  ROOMS: DurableObjectNamespace;
  /** Optional comma-separated origin allowlist. Empty/unset = open. */
  ALLOWED_ORIGINS?: string;
  /** Caps new connections per IP. Absent in local dev. */
  CONNECT_LIMITER?: RateLimiter;
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

/**
 * Path a display connects to when it wants the relay to pick its code.
 *
 * Not a room code itself: codes reach a specific object through `/r/CODE`, and
 * at this point there is no code yet. `MINT_PATH` is reserved, so it can never
 * collide with a real room.
 */
const MINT_PATH = "/new";

/** How many candidate codes to try before admitting defeat. */
const MINT_ATTEMPTS = 5;

/** Room code from `/r/CODE`, falling back to `?room=CODE`. */
function roomCodeFrom(url: URL): string | null {
  const path = url.pathname.split("/").filter(Boolean);
  const fromPath = path[0] === "r" ? path[1] : undefined;
  const code = (fromPath ?? url.searchParams.get("room") ?? "").toUpperCase();
  return ROOM_CODE.test(code) ? code : null;
}

/**
 * Assigns a room code by claiming one, rather than looking one up.
 *
 * A registry of taken codes would be a single object every room creation has to
 * pass through — one thread, one datacenter, and the global room table this
 * architecture exists to avoid. Instead each candidate code is offered to the
 * object that *would* own it. A Durable Object is single-threaded, so "am I
 * already hosting?" is atomic without any coordination, and the work spreads
 * across the keyspace instead of piling onto one object.
 *
 * The claim rides along with the WebSocket upgrade, so a display still opens
 * exactly one connection and learns its code from `ROOM_CREATED`.
 */
async function mintRoom(request: Request, env: Env): Promise<Response> {
  for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt++) {
    const candidate = generateRoomCode();
    const headers = new Headers(request.headers);
    headers.set(ASSIGNED_CODE_HEADER, candidate);

    const stub = env.ROOMS.get(env.ROOMS.idFromName(candidate));
    const response = await stub.fetch(
      new Request(request.url, { headers, method: request.method }),
    );

    // 409 means that object is already hosting a room, so the code is taken.
    if (response.status !== 409) return response;
  }
  return new Response("Could not allocate a room code", { status: 503 });
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

    const minting = url.pathname === MINT_PATH;
    const code = minting ? null : roomCodeFrom(url);
    if (!minting && code === null) {
      return new Response("Missing or invalid room code", { status: 400 });
    }

    // Cap how fast one address can open rooms/connections. This is the
    // replacement for the Bun relay's per-IP connection cap; Cloudflare's own
    // DDoS protection sits in front of it. Absent locally, where the binding
    // does not exist.
    const ip = request.headers.get("CF-Connecting-IP");
    if (env.CONNECT_LIMITER && ip) {
      const { success } = await env.CONNECT_LIMITER.limit({ key: ip });
      if (!success) {
        return new Response("Too many connections", { status: 429 });
      }
    }

    if (minting) return mintRoom(request, env);

    // idFromName maps a room code to a stable object. The object exists
    // whether or not a display has created the room yet; an early joiner just
    // gets ROOM_NOT_FOUND from the empty room, exactly as before.
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code as string));
    return stub.fetch(request);
  },
};
