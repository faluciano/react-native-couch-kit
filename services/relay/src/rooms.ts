/**
 * Game-agnostic relay routing core.
 *
 * Pure, transport-independent logic for a star-topology relay: one **host**
 * (the browser display that owns the game runtime) and many **players** (phones)
 * per room, keyed by a room code. The relay never inspects game payloads — it
 * only tracks membership and routes opaque `DATA` envelopes.
 *
 * This module has no Bun/WebSocket/Node dependency so it can be unit-tested with
 * a fake connection. `server.ts` wraps it with `Bun.serve`.
 *
 * The wire constants below MUST match `@couch-kit/client`'s `relay-protocol.ts`.
 * They are duplicated here (rather than imported) to keep the deployable relay
 * self-contained and dependency-free.
 */

export const RelayMessageTypes = {
  CREATE_ROOM: "CREATE_ROOM",
  ROOM_CREATED: "ROOM_CREATED",
  ROOM_RESUMED: "ROOM_RESUMED",
  JOIN_ROOM: "JOIN_ROOM",
  ROOM_JOINED: "ROOM_JOINED",
  PEER_JOINED: "PEER_JOINED",
  PEER_LEFT: "PEER_LEFT",
  DATA: "DATA",
  DATA_MULTI: "DATA_MULTI",
  ERROR: "ERROR",
} as const;

export const RelayErrorCodes = {
  ROOM_NOT_FOUND: "ROOM_NOT_FOUND",
  ROOM_EXISTS: "ROOM_EXISTS",
  ROOM_FULL: "ROOM_FULL",
  NOT_IN_ROOM: "NOT_IN_ROOM",
  MESSAGE_TOO_LARGE: "MESSAGE_TOO_LARGE",
  MALFORMED: "MALFORMED",
  RATE_LIMITED: "RATE_LIMITED",
  SERVER_BUSY: "SERVER_BUSY",
  /** Reported by clients for a {@link RELAY_CLOSE_HOST_LEFT} close; never sent as an ERROR frame. */
  HOST_LEFT: "HOST_LEFT",
} as const;

/** Matches `@couch-kit/runtime`'s `DEFAULT_MAX_MESSAGE_BYTES`. */
export const MAX_MESSAGE_BYTES = 256 * 1024;

/** RFC 6455 "policy violation" — the client did something it isn't allowed to. */
export const RELAY_CLOSE_POLICY = 1008;

/**
 * The room's host disconnected, taking the room with it. Application-defined
 * (4000-4999). No ERROR frame precedes it: clients that predate this code just
 * see an ordinary drop, retry, and are told ROOM_NOT_FOUND — the right answer,
 * one round trip later.
 */
export const RELAY_CLOSE_HOST_LEFT = 4001;

/**
 * Another connection resumed this host's room. Sent to the connection being
 * replaced — in practice the display's own previous socket, which the relay had
 * not yet noticed was dead.
 */
export const RELAY_CLOSE_HOST_REPLACED = 4002;

/**
 * Most phone messages held for a room whose host is away, and their total size.
 * Beyond either, further messages are dropped: holding exists to bridge a blip,
 * not to buffer a game played without its display.
 */
export const MAX_HELD_MESSAGES = 256;
export const MAX_HELD_BYTES = 1024 * 1024;

/**
 * A close the transport should perform after the core has finished with a
 * message.
 *
 * The core cannot close sockets itself — it has no transport — so it says what
 * should happen and `server.ts` / `room.ts` do it.
 */
export interface RelayClose {
  /** WebSocket close code. */
  code: number;
  /** Human-readable close reason, for logs and devtools. */
  reason: string;
}

/**
 * Abuse-mitigation limits for a public relay. All in-memory and per-process,
 * matching the single-instance deployment model. Defaults are generous for
 * party-game scale while bounding the blast radius of a hostile client.
 */
export interface RelayLimits {
  /** Max concurrent rooms across the process (memory bound). */
  maxRooms: number;
  /** Max players (phones) per room, excluding the host. */
  maxPlayersPerRoom: number;
  /**
   * Messages a player may send within {@link RelayLimits.rateWindowMs}.
   *
   * Kept above the host runtime's own per-connection limit (`RATE_LIMIT_MAX`,
   * 60/s in `@couch-kit/runtime`) so that a fast game is throttled by the
   * runtime — which answers with a recoverable `RATE_LIMITED` error — rather
   * than disconnected here.
   */
  messagesPerWindow: number;
  /**
   * Messages the host may send within {@link RelayLimits.rateWindowMs}.
   *
   * The host is the room's fan-out point: besides its own broadcasts it answers
   * every player's messages (a `PONG` per `PING`, an `ERROR` per rejected
   * action), so its legitimate rate scales with the players. Holding it to the
   * per-player budget let one chatty phone push the display over the limit, and
   * closing the host closes the whole room. The default covers a full room with
   * every player at the runtime's limit (16 × 61 replies) plus broadcasts.
   */
  hostMessagesPerWindow: number;
  /**
   * How long a room outlives a host that dropped without closing its socket —
   * a display whose Wi-Fi blinked, say — waiting for it to resume with the
   * room's token. Phones stay connected meanwhile. A host that closes
   * deliberately ends the room at once.
   */
  hostResumeGraceMs: number;
  /** Sliding-window length for the per-connection message rate limit, in ms. */
  rateWindowMs: number;
}

export const DEFAULT_LIMITS: RelayLimits = {
  maxRooms: 1000,
  maxPlayersPerRoom: 16,
  messagesPerWindow: 75,
  hostMessagesPerWindow: 1200,
  hostResumeGraceMs: 30_000,
  rateWindowMs: 1000,
};

/** UTF-8 byte length of a string (Node/Bun `Buffer` or `TextEncoder`). */
export function byteLength(data: string): number {
  return new TextEncoder().encode(data).length;
}

/**
 * Canonical form of a room code.
 *
 * Room codes are read off a TV and typed or scanned on a phone, so they are
 * case-insensitive: `6dx8` and `6DX8` are the same room. Normalizing here — in
 * the one place that owns room identity — keeps every caller agreeing, whether
 * the code arrived in a URL or in a `CREATE_ROOM` / `JOIN_ROOM` message.
 */
export function normalizeRoomId(roomId: string): string {
  return roomId.toUpperCase();
}

/**
 * Room-code alphabet: no O/0 or I/1, which people confuse when copying a code
 * off a TV across the room.
 */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Length of a minted room code. 32^6 ≈ 1.07e9, so even a relay hosting a
 * million concurrent rooms leaves a blind guess ~0.1% likely to reach a live
 * game. The code is the only credential a player needs, so the keyspace has to
 * stay far larger than the number of live rooms.
 */
export const ROOM_CODE_LENGTH = 6;

/**
 * A random room code.
 *
 * Uses the CSPRNG rather than `Math.random`, whose output is predictable from
 * previous draws — codes are guessable enough without handing out the sequence.
 * The alphabet is 32 characters and 256 is a whole multiple of it, so taking
 * bytes modulo the length is unbiased.
 */
export function generateRoomCode(length: number = ROOM_CODE_LENGTH): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) {
    code += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length];
  }
  return code;
}

/**
 * A room's resume token: 128 bits from the CSPRNG, hex-encoded. Whoever holds
 * it can take the room over, so it is only ever sent to the room's host.
 */
export function generateResumeToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/** Compares secrets in time independent of where they first differ. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * How many codes to try before giving up on minting.
 *
 * Each attempt fails only on a collision, so with the keyspace far larger than
 * the live-room count the first attempt essentially always wins; this bound
 * only matters if a relay is somehow near capacity.
 */
const MINT_ATTEMPTS = 5;

/** A single relay connection: an id plus a way to push a raw string to it. */
export interface RelayConnection {
  id: string;
  send(data: string): void;
  /**
   * Closes the underlying socket. Optional so a fake connection in a test need
   * not supply it; both real transports do. Used when the core must end a
   * connection it is not currently handling a message for — a player whose
   * host just left.
   */
  close?(code: number, reason: string): void;
}

interface Room {
  /** Null while the host is away: dropped, and neither back nor timed out. */
  host: RelayConnection | null;
  players: Map<string, RelayConnection>;
  /**
   * Credential for resuming the room. Null for a room restored from before
   * resumption existed, which therefore cannot be resumed.
   */
  resumeToken: string | null;
  /** When the host dropped, while {@link Room.host} is null. */
  hostGoneAt: number | null;
  /** Phone messages waiting for an absent host, oldest first. */
  held: { from: string; data: string }[];
  heldBytes: number;
}

/**
 * The part of a room that cannot be recovered from its sockets: what a relay
 * that may lose its memory (a hibernating Durable Object) must persist to keep
 * a room resumable, and hand back to {@link RelayRooms.restore}.
 */
export interface RoomResumeState {
  roomId: string;
  resumeToken: string | null;
  hostGoneAt: number | null;
}

interface Membership {
  roomId: string;
  role: "host" | "player";
}

/**
 * In-memory relay room registry. One instance holds every room for a single
 * server process; membership is per connection id. A single instance is
 * sufficient for POC / party-game scale — a multi-instance backplane is future
 * work.
 */
export class RelayRooms {
  private readonly rooms = new Map<string, Room>();
  private readonly membership = new Map<string, Membership>();
  /** Sliding-window message timestamps per connection id (rate limiting). */
  private readonly rate = new Map<string, number[]>();
  private readonly limits: RelayLimits;
  private readonly now: () => number;

  /** Supplies the code for a `CREATE_ROOM` that did not name one. */
  private readonly mintRoomCode: () => string | null;

  constructor(
    limits: Partial<RelayLimits> = {},
    now: () => number = Date.now,
    /**
     * Overrides how an unnamed room gets its code.
     *
     * The default suits a relay that holds every room in one table: generate a
     * code and check it against that table. A sharded relay cannot do that —
     * a Cloudflare Durable Object *is* a single room and has no view of the
     * others — so it claims the code before the socket ever reaches the core
     * and passes the result in here.
     */
    mintRoomCode?: () => string | null,
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.now = now;
    this.mintRoomCode = mintRoomCode ?? (() => this.mintUnusedCode());
  }

  /** A code no room in this table is using, or `null` if repeated tries collided. */
  private mintUnusedCode(): string | null {
    for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt++) {
      const code = generateRoomCode();
      if (!this.rooms.has(code)) return code;
    }
    return null;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  /** Current room + role for a connection id, or `undefined` if unknown. */
  membershipOf(id: string): Readonly<Membership> | undefined {
    return this.membership.get(id);
  }

  /**
   * Rebuild membership for connections that already exist, without emitting any
   * protocol messages.
   *
   * Needed by hosts that can evict this object from memory while its sockets
   * stay open — a Cloudflare Durable Object waking from hibernation, say. The
   * sockets survive; this in-memory routing table does not, so it is restored
   * from what the transport still holds. Replaying CREATE_ROOM / JOIN_ROOM
   * instead would re-notify clients of things they already know.
   */
  restore(
    entries: readonly {
      readonly conn: RelayConnection;
      readonly roomId: string;
      readonly role: "host" | "player";
    }[],
    /**
     * What {@link RelayRooms.resumeStateOf} reported before the memory was
     * lost. Without it, rooms come back unresumable, and a room whose host was
     * away comes back without its players' room.
     */
    states: readonly RoomResumeState[] = [],
  ): void {
    for (const state of states) {
      this.rooms.set(normalizeRoomId(state.roomId), {
        host: null,
        players: new Map(),
        resumeToken: state.resumeToken,
        hostGoneAt: state.hostGoneAt,
        held: [],
        heldBytes: 0,
      });
    }
    for (const { conn, roomId: raw, role } of entries) {
      const roomId = normalizeRoomId(raw);
      let room = this.rooms.get(roomId);
      if (!room && role === "host") {
        room = this.newRoom(conn, null);
        this.rooms.set(roomId, room);
      } else if (room && role === "host") {
        room.host = conn;
        room.hostGoneAt = null;
      }
      this.membership.set(conn.id, { roomId, role });
    }
    // Players are attached after hosts so a player restored before its host
    // still lands in the room.
    for (const { conn, roomId, role } of entries) {
      if (role !== "player") continue;
      this.rooms.get(normalizeRoomId(roomId))?.players.set(conn.id, conn);
    }
    // A room that had a host when its state was saved, but whose host socket
    // is gone now, lost it while nobody was watching — a relay restart drops
    // every socket without a close event. Start its grace period now, or it
    // would wait for a host forever.
    for (const room of this.rooms.values()) {
      if (room.host === null && room.hostGoneAt === null) {
        room.hostGoneAt = this.now();
      }
    }
  }

  /**
   * Route one raw inbound message from `conn`.
   *
   * @returns `null` to keep the connection open, or the close the transport
   *   should perform. The error frame is always sent first, so a client learns
   *   *why* before the socket goes.
   */
  handleMessage(conn: RelayConnection, raw: string): RelayClose | null {
    if (!this.allow(conn.id)) {
      this.sendError(conn, RelayErrorCodes.RATE_LIMITED, "Too many messages");
      return { code: RELAY_CLOSE_POLICY, reason: "Rate limited" };
    }

    if (byteLength(raw) > MAX_MESSAGE_BYTES) {
      this.sendError(
        conn,
        RelayErrorCodes.MESSAGE_TOO_LARGE,
        "Message too large",
      );
      return null;
    }

    let msg: {
      type?: string;
      roomId?: string;
      resumeToken?: string;
      to?: string;
      data?: string;
      payloads?: Record<string, string>;
    };
    try {
      msg = JSON.parse(raw);
    } catch {
      this.sendError(conn, RelayErrorCodes.MALFORMED, "Invalid JSON");
      return null;
    }

    switch (msg.type) {
      case RelayMessageTypes.CREATE_ROOM:
        if (msg.resumeToken !== undefined) {
          this.resumeRoom(conn, msg.roomId, msg.resumeToken);
        } else {
          this.createRoom(conn, msg.roomId);
        }
        break;
      case RelayMessageTypes.JOIN_ROOM:
        return this.joinRoom(conn, msg.roomId);
      case RelayMessageTypes.DATA:
        this.routeData(conn, msg.data, msg.to);
        break;
      case RelayMessageTypes.DATA_MULTI:
        this.routeMulti(conn, msg.payloads);
        break;
      default:
        this.sendError(conn, RelayErrorCodes.MALFORMED, "Unknown message type");
    }
    return null;
  }

  /**
   * Sliding-window rate limit. Records this message's timestamp and returns
   * `false` once a connection exceeds its budget within
   * {@link RelayLimits.rateWindowMs}: {@link RelayLimits.hostMessagesPerWindow}
   * for a room's host, {@link RelayLimits.messagesPerWindow} for anyone else.
   */
  private allow(id: string): boolean {
    const t = this.now();
    const cutoff = t - this.limits.rateWindowMs;
    let hits = this.rate.get(id);
    if (!hits) {
      hits = [];
      this.rate.set(id, hits);
    }
    // Timestamps arrive in order, so expired ones are always at the front.
    // Dropping them from there keeps a busy host's check cheap, where
    // re-filtering the whole window on every message would not be.
    let expired = 0;
    while (expired < hits.length && hits[expired] <= cutoff) expired++;
    if (expired > 0) hits.splice(0, expired);
    hits.push(t);
    const budget =
      this.membership.get(id)?.role === "host"
        ? this.limits.hostMessagesPerWindow
        : this.limits.messagesPerWindow;
    return hits.length <= budget;
  }

  /**
   * Clean up a closed connection and notify its room.
   *
   * @param options.abnormal - The socket died without a close frame (code
   *   1006): a network drop rather than a decision to leave. A host that drops
   *   this way leaves its room waiting for it to resume, for
   *   {@link RelayLimits.hostResumeGraceMs}; any other host departure ends the
   *   room immediately.
   */
  handleClose(
    conn: RelayConnection,
    options: { abnormal?: boolean } = {},
  ): void {
    this.rate.delete(conn.id);
    const mem = this.membership.get(conn.id);
    if (!mem) return;
    this.membership.delete(conn.id);

    const room = this.rooms.get(mem.roomId);
    if (!room) return;

    if (mem.role === "host") {
      if (options.abnormal && room.resumeToken !== null) {
        room.host = null;
        room.hostGoneAt = this.now();
        return;
      }
      this.endRoom(mem.roomId);
    } else {
      room.players.delete(conn.id);
      // An absent host learns who is still here from ROOM_RESUMED instead.
      if (room.host) {
        this.send(room.host, {
          type: RelayMessageTypes.PEER_LEFT,
          roomId: mem.roomId,
          peerId: conn.id,
        });
      }
    }
  }

  /**
   * Ends every room whose host has been away longer than
   * {@link RelayLimits.hostResumeGraceMs}. The core keeps no timers, so the
   * transport calls this — on an interval, or from an alarm set for
   * {@link RelayRooms.nextExpiryAt}.
   *
   * @returns the codes of the rooms that ended.
   */
  expireAbandonedRooms(): string[] {
    const cutoff = this.now() - this.limits.hostResumeGraceMs;
    const ended: string[] = [];
    for (const [roomId, room] of this.rooms) {
      if (room.hostGoneAt !== null && room.hostGoneAt <= cutoff) {
        ended.push(roomId);
      }
    }
    for (const roomId of ended) this.endRoom(roomId);
    return ended;
  }

  /** When the next room waiting for its host will expire, or `null` if none is. */
  nextExpiryAt(): number | null {
    let next: number | null = null;
    for (const room of this.rooms.values()) {
      if (room.hostGoneAt === null) continue;
      const at = room.hostGoneAt + this.limits.hostResumeGraceMs;
      if (next === null || at < next) next = at;
    }
    return next;
  }

  /**
   * What must survive a loss of memory to keep `roomId` resumable, or
   * `undefined` if there is no such room. See {@link RoomResumeState}.
   */
  resumeStateOf(roomId: string): RoomResumeState | undefined {
    const room = this.rooms.get(normalizeRoomId(roomId));
    if (!room) return undefined;
    return {
      roomId: normalizeRoomId(roomId),
      resumeToken: room.resumeToken,
      hostGoneAt: room.hostGoneAt,
    };
  }

  /**
   * The room is over: drop it and its players with it. A phone left connected
   * would sit on "connected" showing stale state, with nothing to tell it the
   * game is over — and on the Workers relay its socket would keep the room's
   * Durable Object occupied.
   */
  private endRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const players = Array.from(room.players.values());
    for (const player of players) {
      this.membership.delete(player.id);
      this.rate.delete(player.id);
    }
    this.rooms.delete(roomId);
    for (const player of players) {
      player.close?.(RELAY_CLOSE_HOST_LEFT, RelayErrorCodes.HOST_LEFT);
    }
  }

  private newRoom(host: RelayConnection, resumeToken: string | null): Room {
    return {
      host,
      players: new Map(),
      resumeToken,
      hostGoneAt: null,
      held: [],
      heldBytes: 0,
    };
  }

  private createRoom(conn: RelayConnection, rawRoomId?: string): void {
    if (this.membership.has(conn.id)) {
      this.sendError(conn, RelayErrorCodes.MALFORMED, "Already in a room");
      return;
    }
    // No code named: the relay picks one. This is the path displays use — a
    // client-chosen code cannot be checked for collisions before it is already
    // on screen, and lets a caller squat on a code someone else is using.
    if (!rawRoomId) {
      const minted = this.mintRoomCode();
      if (minted === null) {
        this.sendError(
          conn,
          RelayErrorCodes.SERVER_BUSY,
          "Could not mint a room code",
        );
        return;
      }
      this.openRoom(conn, minted);
      return;
    }
    const roomId = normalizeRoomId(rawRoomId);
    if (this.rooms.has(roomId)) {
      this.sendError(conn, RelayErrorCodes.ROOM_EXISTS, "Room already exists");
      return;
    }
    if (this.rooms.size >= this.limits.maxRooms) {
      this.sendError(conn, RelayErrorCodes.SERVER_BUSY, "Too many rooms");
      return;
    }
    this.openRoom(conn, roomId);
  }

  /** Registers the room and tells the host its code and resume token. */
  private openRoom(conn: RelayConnection, roomId: string): void {
    const resumeToken = generateResumeToken();
    this.rooms.set(roomId, this.newRoom(conn, resumeToken));
    this.membership.set(conn.id, { roomId, role: "host" });
    this.send(conn, {
      type: RelayMessageTypes.ROOM_CREATED,
      roomId,
      peerId: conn.id,
      resumeToken,
    });
  }

  /**
   * Hands a room back to the host that created it, on a new connection.
   *
   * A wrong token, or a room that has already ended, is `ROOM_NOT_FOUND`
   * either way, so the answer does not reveal which codes are live.
   */
  private resumeRoom(
    conn: RelayConnection,
    rawRoomId: string | undefined,
    resumeToken: string,
  ): void {
    if (this.membership.has(conn.id)) {
      this.sendError(conn, RelayErrorCodes.MALFORMED, "Already in a room");
      return;
    }
    const roomId = normalizeRoomId(rawRoomId ?? "");
    const room = this.rooms.get(roomId);
    if (
      !room ||
      room.resumeToken === null ||
      typeof resumeToken !== "string" ||
      !sameSecret(room.resumeToken, resumeToken)
    ) {
      this.sendError(conn, RelayErrorCodes.ROOM_NOT_FOUND, "Room not found");
      return;
    }

    // The previous host connection may still look alive: a socket that died
    // without a close frame is only noticed when a write to it fails. It is
    // being replaced either way.
    const previous = room.host;
    if (previous) {
      this.membership.delete(previous.id);
      this.rate.delete(previous.id);
      previous.close?.(RELAY_CLOSE_HOST_REPLACED, "Host replaced");
    }

    room.host = conn;
    room.hostGoneAt = null;
    this.membership.set(conn.id, { roomId, role: "host" });
    this.send(conn, {
      type: RelayMessageTypes.ROOM_RESUMED,
      roomId,
      peerId: conn.id,
      peers: Array.from(room.players.keys()),
    });

    // Deliver what phones sent while the host was away. A phone that has
    // since left is skipped: ROOM_RESUMED did not list it, so its messages
    // would arrive from a connection the host has never heard of.
    const held = room.held;
    room.held = [];
    room.heldBytes = 0;
    for (const { from, data } of held) {
      if (!room.players.has(from)) continue;
      this.send(conn, {
        type: RelayMessageTypes.DATA,
        roomId,
        from,
        data,
      });
    }
  }

  /**
   * @returns the close to perform, or `null` to keep the socket open. A join
   *   against a room that does not exist is terminal: the code is wrong and no
   *   later message on this socket can fix it. Closing keeps a mistyped or
   *   sprayed code from parking a connection — and, on the Workers relay, from
   *   holding open a Durable Object for a room that was never created.
   */
  private joinRoom(
    conn: RelayConnection,
    rawRoomId?: string,
  ): RelayClose | null {
    if (!rawRoomId) {
      this.sendError(conn, RelayErrorCodes.MALFORMED, "Missing roomId");
      return null;
    }
    const roomId = normalizeRoomId(rawRoomId);
    const room = this.rooms.get(roomId);
    if (!room) {
      this.sendError(conn, RelayErrorCodes.ROOM_NOT_FOUND, "Room not found");
      return { code: RELAY_CLOSE_POLICY, reason: "Room not found" };
    }
    if (room.players.size >= this.limits.maxPlayersPerRoom) {
      // Not terminal, unlike a bad code: a slot can open up, so let the client
      // decide whether to wait.
      this.sendError(conn, RelayErrorCodes.ROOM_FULL, "Room is full");
      return null;
    }
    room.players.set(conn.id, conn);
    this.membership.set(conn.id, { roomId, role: "player" });
    this.send(conn, {
      type: RelayMessageTypes.ROOM_JOINED,
      roomId,
      peerId: conn.id,
    });
    // An absent host learns about this phone from ROOM_RESUMED instead.
    if (room.host) {
      this.send(room.host, {
        type: RelayMessageTypes.PEER_JOINED,
        roomId,
        peerId: conn.id,
      });
    }
    return null;
  }

  private routeData(conn: RelayConnection, data?: string, to?: string): void {
    const mem = this.membership.get(conn.id);
    if (!mem) {
      this.sendError(conn, RelayErrorCodes.NOT_IN_ROOM, "Not in a room");
      return;
    }
    if (data === undefined) {
      this.sendError(conn, RelayErrorCodes.MALFORMED, "Missing data");
      return;
    }
    const room = this.rooms.get(mem.roomId);
    if (!room) return;

    if (mem.role === "player") {
      if (!room.host) {
        this.hold(room, conn.id, data);
        return;
      }
      // Player -> host, tagged with the sender's id.
      this.send(room.host, {
        type: RelayMessageTypes.DATA,
        roomId: mem.roomId,
        from: conn.id,
        data,
      });
    } else if (to !== undefined) {
      // Host -> a specific player (unicast).
      const player = room.players.get(to);
      if (player) {
        this.send(player, {
          type: RelayMessageTypes.DATA,
          roomId: mem.roomId,
          data,
        });
      }
    } else {
      // Host -> all players (broadcast).
      for (const player of room.players.values()) {
        this.send(player, {
          type: RelayMessageTypes.DATA,
          roomId: mem.roomId,
          data,
        });
      }
    }
  }

  /**
   * Host → many players in one frame: `payloads` maps a player's peer id to the
   * payload meant for that player alone.
   *
   * This exists because a projected game (one where each phone sees a different
   * view) otherwise sends one frame per player for every state change, and a
   * relay bills — and rate-limits — per inbound frame. Fanning out here turns
   * an N-player broadcast into a single inbound message.
   *
   * Players are delivered ordinary {@link RelayMessageTypes.DATA} frames, so
   * nothing on the phone side knows this type exists and no client needs to be
   * upgraded to benefit.
   */
  private routeMulti(
    conn: RelayConnection,
    payloads?: Record<string, string>,
  ): void {
    const mem = this.membership.get(conn.id);
    if (!mem) {
      this.sendError(conn, RelayErrorCodes.NOT_IN_ROOM, "Not in a room");
      return;
    }
    // Only the host addresses players individually. A player reaching for this
    // would be routing around the star topology to message the room directly.
    if (mem.role !== "host") {
      this.sendError(conn, RelayErrorCodes.MALFORMED, "Not the host");
      return;
    }
    if (payloads === null || typeof payloads !== "object") {
      this.sendError(conn, RelayErrorCodes.MALFORMED, "Missing payloads");
      return;
    }
    const room = this.rooms.get(mem.roomId);
    if (!room) return;

    for (const [peerId, data] of Object.entries(payloads)) {
      // A non-string payload is the one thing that would put malformed data on
      // a phone's wire, since everything else here is opaque to us.
      if (typeof data !== "string") {
        this.sendError(
          conn,
          RelayErrorCodes.MALFORMED,
          "Payload is not a string",
        );
        return;
      }
      // Unknown peer: skip, don't error. A projection built moments before a
      // player left is routine, and the host already learns about the departure
      // from PEER_LEFT.
      const player = room.players.get(peerId);
      if (!player) continue;
      this.send(player, {
        type: RelayMessageTypes.DATA,
        roomId: mem.roomId,
        data,
      });
    }
  }

  /**
   * Keeps a phone's message for its absent host, within
   * {@link MAX_HELD_MESSAGES} / {@link MAX_HELD_BYTES}. Past those it is
   * dropped, as it would have been had the room simply ended.
   */
  private hold(room: Room, from: string, data: string): void {
    const bytes = byteLength(data);
    if (
      room.held.length >= MAX_HELD_MESSAGES ||
      room.heldBytes + bytes > MAX_HELD_BYTES
    ) {
      return;
    }
    room.held.push({ from, data });
    room.heldBytes += bytes;
  }

  private send(conn: RelayConnection, message: unknown): void {
    conn.send(JSON.stringify(message));
  }

  private sendError(
    conn: RelayConnection,
    code: string,
    message: string,
  ): void {
    this.send(conn, { type: RelayMessageTypes.ERROR, code, message });
  }
}
