import { resolveWebSocketUrl, type LocationLike } from "./connection";
import { normalizeRoomCode } from "./relay-room";
import { createRelayTransport } from "./relay-transport";
import {
  createWebSocketTransport,
  type CreateClientTransport,
} from "./transport";

/** Options for {@link createAutoTransport}. */
export interface AutoTransportOptions {
  /**
   * Relay to use when the controller joins by room code. Take it from build
   * config (e.g. `import.meta.env.VITE_RELAY_URL`) rather than from the page
   * URL: a relay named in a link is a relay anyone can name, and the phone
   * would send its session to it.
   */
  relayUrl?: string | null;
  /**
   * Room code to join. `undefined` reads `?room=` from the page URL; `null`
   * means no room. Any room code selects the relay, so a hosted controller
   * never tries a LAN socket.
   */
  roomId?: string | null;
  /** Explicit LAN WebSocket URL; selects the LAN transport when no room is set. */
  url?: string;
  /** LAN WebSocket port override (default: the page's HTTP port + 2). */
  wsPort?: number;
  /** Page location to decide from. Defaults to `window.location`. */
  location?: (LocationLike & { search?: string }) | null;
}

/** Why {@link createAutoTransport} could not pick a transport. */
export type AutoTransportUnavailableReason =
  /** A room code was given, but no `relayUrl` to reach it through. */
  | "NO_RELAY_URL"
  /**
   * The page was not served by a TV host on the local network, and no room
   * code was given. Show a join screen and ask for one.
   */
  | "NEEDS_ROOM_CODE";

/**
 * The transport {@link createAutoTransport} picked. Pass `createTransport` and
 * `connectionKey` straight to `useGameClient`; show `kind` to the player
 * ("Local" vs "Room ABCD"). With `kind: "none"`, do not mount the client.
 */
export type AutoTransport =
  | {
      kind: "relay";
      roomId: string;
      relayUrl: string;
      createTransport: CreateClientTransport;
      connectionKey: string;
    }
  | {
      kind: "lan";
      url: string;
      createTransport: CreateClientTransport;
      connectionKey: string;
    }
  | {
      kind: "none";
      reason: AutoTransportUnavailableReason;
      createTransport: undefined;
      connectionKey: null;
    };

/**
 * Whether a hostname is on the local network: a private IPv4 address
 * (10/8, 172.16/12, 192.168/16, 169.254/16) or an mDNS `.local` name. That is
 * where a TV host's static server is reached from a phone.
 */
export function isLocalNetworkHost(hostname: string): boolean {
  if (hostname.endsWith(".local")) return true;
  const parts = hostname.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) =>
    /^\d{1,3}$/.test(part) ? Number(part) : NaN,
  );
  if (octets.some((octet) => Number.isNaN(octet) || octet > 255)) return false;
  const [a, b] = octets;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function roomFromSearch(search: string | undefined): string | null {
  if (!search) return null;
  try {
    const raw = new URLSearchParams(search).get("room");
    const code = raw ? normalizeRoomCode(raw) : "";
    return code.length > 0 ? code : null;
  } catch {
    return null;
  }
}

/**
 * Picks how a controller reaches its host, so one controller build works both
 * on the TV's local network and through the relay.
 *
 * 1. A room code (given, or `?room=` in the page URL) selects the relay.
 * 2. Otherwise an explicit `url`, or a page served over `http:` from a
 *    local-network address (the TV host's static server), selects the LAN
 *    WebSocket at HTTP port + 2.
 * 3. Otherwise there is nothing to connect to yet: `kind: "none"`.
 *
 * Pure apart from reading `window.location` when `location` is omitted, so
 * call it during render (memoized on `roomId`).
 *
 * @example
 * ```tsx
 * const { roomId, setRoomId } = useRelayRoom();
 * const transport = useMemo(
 *   () => createAutoTransport({ relayUrl: import.meta.env.VITE_RELAY_URL, roomId }),
 *   [roomId],
 * );
 * if (transport.kind === "none") return <JoinScreen onJoin={setRoomId} />;
 * return <Controller transport={transport} />;
 *
 * // In Controller:
 * useGameClient({
 *   reducer,
 *   initialState,
 *   createTransport: transport.createTransport,
 *   connectionKey: transport.connectionKey,
 * });
 * ```
 */
export function createAutoTransport(
  options: AutoTransportOptions = {},
): AutoTransport {
  const location =
    options.location !== undefined
      ? options.location
      : typeof window !== "undefined"
        ? window.location
        : null;

  const rawRoom =
    options.roomId === undefined
      ? roomFromSearch(location?.search)
      : options.roomId;
  const roomId = rawRoom ? normalizeRoomCode(rawRoom) : "";

  if (roomId.length > 0) {
    if (!options.relayUrl) {
      return {
        kind: "none",
        reason: "NO_RELAY_URL",
        createTransport: undefined,
        connectionKey: null,
      };
    }
    const relayUrl = options.relayUrl;
    return {
      kind: "relay",
      roomId,
      relayUrl,
      createTransport: createRelayTransport({ url: relayUrl, roomId }),
      connectionKey: `relay:${relayUrl}#${roomId}`,
    };
  }

  const servedByLanHost =
    location !== null &&
    location.protocol === "http:" &&
    isLocalNetworkHost(location.hostname);
  if (options.url || servedByLanHost) {
    const url = resolveWebSocketUrl(
      { url: options.url, wsPort: options.wsPort },
      location,
    );
    if (url) {
      return {
        kind: "lan",
        url,
        createTransport: () => createWebSocketTransport(url),
        connectionKey: `lan:${url}`,
      };
    }
  }

  return {
    kind: "none",
    reason: "NEEDS_ROOM_CODE",
    createTransport: undefined,
    connectionKey: null,
  };
}
