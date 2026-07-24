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
} as const;

/** Matches `@couch-kit/runtime`'s `DEFAULT_MAX_MESSAGE_BYTES`. */
export const MAX_MESSAGE_BYTES = 256 * 1024;

/** UTF-8 byte length of a string (Node/Bun `Buffer` or `TextEncoder`). */
export function byteLength(data: string): number {
  return new TextEncoder().encode(data).length;
}

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

  get roomCount(): number {
    return this.rooms.size;
  }

  /** Route one raw inbound message from `conn`. */
  handleMessage(conn: RelayConnection, raw: string): void {
    if (byteLength(raw) > MAX_MESSAGE_BYTES) {
      this.sendError(conn, RelayErrorCodes.MESSAGE_TOO_LARGE, "Message too large");
      return;
    }

    let msg: { type?: string; roomId?: string; to?: string; data?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      this.sendError(conn, RelayErrorCodes.MALFORMED, "Invalid JSON");
      return;
    }

    switch (msg.type) {
      case RelayMessageTypes.CREATE_ROOM:
        this.createRoom(conn, msg.roomId);
        break;
      case RelayMessageTypes.JOIN_ROOM:
        this.joinRoom(conn, msg.roomId);
        break;
      case RelayMessageTypes.DATA:
        this.routeData(conn, msg.data, msg.to);
        break;
      default:
        this.sendError(conn, RelayErrorCodes.MALFORMED, "Unknown message type");
    }
  }

  /** Clean up a closed connection and notify its room. */
  handleClose(conn: RelayConnection): void {
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

  private createRoom(conn: RelayConnection, roomId?: string): void {
    if (!roomId) {
      this.sendError(conn, RelayErrorCodes.MALFORMED, "Missing roomId");
      return;
    }
    if (this.rooms.has(roomId)) {
      this.sendError(conn, RelayErrorCodes.ROOM_EXISTS, "Room already exists");
      return;
    }
    this.rooms.set(roomId, { host: conn, players: new Map() });
    this.membership.set(conn.id, { roomId, role: "host" });
    this.send(conn, {
      type: RelayMessageTypes.ROOM_CREATED,
      roomId,
      peerId: conn.id,
    });
  }

  private joinRoom(conn: RelayConnection, roomId?: string): void {
    if (!roomId) {
      this.sendError(conn, RelayErrorCodes.MALFORMED, "Missing roomId");
      return;
    }
    const room = this.rooms.get(roomId);
    if (!room) {
      this.sendError(conn, RelayErrorCodes.ROOM_NOT_FOUND, "Room not found");
      return;
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
