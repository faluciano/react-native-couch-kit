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
  JOIN_ROOM: "JOIN_ROOM",
  ROOM_JOINED: "ROOM_JOINED",
  PEER_JOINED: "PEER_JOINED",
  PEER_LEFT: "PEER_LEFT",
  DATA: "DATA",
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
} as const;

/** Matches `@couch-kit/runtime`'s `DEFAULT_MAX_MESSAGE_BYTES`. */
export const MAX_MESSAGE_BYTES = 256 * 1024;

/** RFC 6455 "policy violation" — the client did something it isn't allowed to. */
export const RELAY_CLOSE_POLICY = 1008;

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
  /** Messages allowed per connection within {@link RelayLimits.rateWindowMs}. */
  messagesPerWindow: number;
  /** Sliding-window length for the per-connection message rate limit, in ms. */
  rateWindowMs: number;
}

export const DEFAULT_LIMITS: RelayLimits = {
  maxRooms: 1000,
  maxPlayersPerRoom: 16,
  messagesPerWindow: 30,
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
}

interface Room {
  host: RelayConnection;
  players: Map<string, RelayConnection>;
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
  ): void {
    for (const { conn, roomId: raw, role } of entries) {
      const roomId = normalizeRoomId(raw);
      let room = this.rooms.get(roomId);
      if (!room && role === "host") {
        room = { host: conn, players: new Map() };
        this.rooms.set(roomId, room);
      }
      this.membership.set(conn.id, { roomId, role });
    }
    // Players are attached after hosts so a player restored before its host
    // still lands in the room.
    for (const { conn, roomId, role } of entries) {
      if (role !== "player") continue;
      this.rooms.get(normalizeRoomId(roomId))?.players.set(conn.id, conn);
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
      this.sendError(conn, RelayErrorCodes.MESSAGE_TOO_LARGE, "Message too large");
      return null;
    }

    let msg: { type?: string; roomId?: string; to?: string; data?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      this.sendError(conn, RelayErrorCodes.MALFORMED, "Invalid JSON");
      return null;
    }

    switch (msg.type) {
      case RelayMessageTypes.CREATE_ROOM:
        this.createRoom(conn, msg.roomId);
        break;
      case RelayMessageTypes.JOIN_ROOM:
        return this.joinRoom(conn, msg.roomId);
      case RelayMessageTypes.DATA:
        this.routeData(conn, msg.data, msg.to);
        break;
      default:
        this.sendError(conn, RelayErrorCodes.MALFORMED, "Unknown message type");
    }
    return null;
  }

  /**
   * Sliding-window rate limit. Records this message's timestamp and returns
   * `false` once a connection exceeds {@link RelayLimits.messagesPerWindow}
   * within {@link RelayLimits.rateWindowMs}.
   */
  private allow(id: string): boolean {
    const t = this.now();
    const cutoff = t - this.limits.rateWindowMs;
    const hits = (this.rate.get(id) ?? []).filter((ts) => ts > cutoff);
    hits.push(t);
    this.rate.set(id, hits);
    return hits.length <= this.limits.messagesPerWindow;
  }

  /** Clean up a closed connection and notify its room. */
  handleClose(conn: RelayConnection): void {
    this.rate.delete(conn.id);
    const mem = this.membership.get(conn.id);
    if (!mem) return;
    this.membership.delete(conn.id);

    const room = this.rooms.get(mem.roomId);
    if (!room) return;

    if (mem.role === "host") {
      // Host is gone: the room is dead. Drop it and detach players.
      for (const player of room.players.values()) {
        this.membership.delete(player.id);
      }
      this.rooms.delete(mem.roomId);
    } else {
      room.players.delete(conn.id);
      this.send(room.host, {
        type: RelayMessageTypes.PEER_LEFT,
        roomId: mem.roomId,
        peerId: conn.id,
      });
    }
  }

  private createRoom(conn: RelayConnection, rawRoomId?: string): void {
    // No code named: the relay picks one. This is the path displays use — a
    // client-chosen code cannot be checked for collisions before it is already
    // on screen, and lets a caller squat on a code someone else is using.
    if (!rawRoomId) {
      const minted = this.mintRoomCode();
      if (minted === null) {
        this.sendError(conn, RelayErrorCodes.SERVER_BUSY, "Could not mint a room code");
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

  /** Registers the room and tells the host its code. */
  private openRoom(conn: RelayConnection, roomId: string): void {
    this.rooms.set(roomId, { host: conn, players: new Map() });
    this.membership.set(conn.id, { roomId, role: "host" });
    this.send(conn, {
      type: RelayMessageTypes.ROOM_CREATED,
      roomId,
      peerId: conn.id,
    });
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
    this.send(room.host, {
      type: RelayMessageTypes.PEER_JOINED,
      roomId,
      peerId: conn.id,
    });
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

  private send(conn: RelayConnection, message: unknown): void {
    conn.send(JSON.stringify(message));
  }

  private sendError(conn: RelayConnection, code: string, message: string): void {
    this.send(conn, { type: RelayMessageTypes.ERROR, code, message });
  }
}
