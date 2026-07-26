/**
 * One room = one Durable Object.
 *
 * The routing logic is the same {@link RelayRooms} core the Bun relay uses, so
 * the wire protocol is identical; this class only supplies the transport and
 * the hibernation lifecycle.
 *
 * Hibernation is what makes this nearly free: an idle room (a lobby waiting for
 * players, a table between turns) is evicted from memory while its WebSockets
 * stay open, and evicted objects are not billed for duration. That works here
 * because the relay holds no game state — the browser display owns the game.
 * All this object knows is who is in the room, and that is recoverable from the
 * sockets themselves on wake.
 */

import { RelayRooms, type RelayConnection } from "../../relay/src/rooms";

/**
 * Header carrying a candidate room code from the router to the object that
 * would own it. Declared here, with the object that answers it, because the
 * router already imports this module.
 */
export const ASSIGNED_CODE_HEADER = "X-Assigned-Room";

/** Per-socket state that must outlive hibernation. */
interface Attachment {
  peerId: string;
  roomId?: string;
  role?: "host" | "player";
  /**
   * Code the router claimed for this socket, before the core has seen a
   * `CREATE_ROOM`. Kept on the socket rather than in storage so an object that
   * hibernates and wakes still knows what it was called, with no writes and
   * nothing to clean up.
   */
  assignedCode?: string;
}

export class RelayRoom implements DurableObject {
  private core: RelayRooms | null = null;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: unknown,
  ) {}

  /**
   * Routing table for this room, rebuilt from the live sockets on first use
   * after a wake. `maxRooms: 1` because a Durable Object *is* one room.
   */
  private rooms(): RelayRooms {
    if (this.core) return this.core;

    // The core's default minting scans a table of every room, which a single
    // room cannot do. The router already claimed a code for us, so hand that
    // back instead.
    const core = new RelayRooms({ maxRooms: 1 }, Date.now, () =>
      this.claimedCode(),
    );
    const entries: {
      conn: RelayConnection;
      roomId: string;
      role: "host" | "player";
    }[] = [];

    for (const ws of this.ctx.getWebSockets()) {
      const att = this.attachment(ws);
      if (att?.roomId && att.role) {
        entries.push({
          conn: this.connection(ws, att.peerId),
          roomId: att.roomId,
          role: att.role,
        });
      }
    }
    if (entries.length > 0) core.restore(entries);

    this.core = core;
    return core;
  }

  /** The code the router claimed for this object, read back off the sockets. */
  private claimedCode(): string | null {
    for (const ws of this.ctx.getWebSockets()) {
      const code = this.attachment(ws)?.assignedCode;
      if (code) return code;
    }
    return null;
  }

  /**
   * Whether this object already represents a live room.
   *
   * Hibernated sockets are still returned here, so a room that is merely idle
   * — a lobby waiting for players — correctly counts as occupied. When the last
   * socket goes, the object empties and its code becomes available again, which
   * is what keeps the keyspace from filling up with nothing.
   */
  private occupied(): boolean {
    return this.ctx.getWebSockets().length > 0;
  }

  private attachment(ws: WebSocket): Attachment | null {
    try {
      return (ws.deserializeAttachment() as Attachment | null) ?? null;
    } catch {
      return null;
    }
  }

  private connection(ws: WebSocket, id: string): RelayConnection {
    return {
      id,
      send: (data: string) => {
        try {
          ws.send(data);
        } catch {
          // Socket died between routing and send; the close handler cleans up.
        }
      },
    };
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    // A claim for a code this object cannot give out. Refusing here — before
    // any socket is accepted — is the whole collision check: this object runs
    // single-threaded, so no concurrent claim can slip between the test and
    // the accept below.
    const assignedCode = request.headers.get(ASSIGNED_CODE_HEADER);
    if (assignedCode !== null && this.occupied()) {
      return new Response("Room code taken", { status: 409 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // acceptWebSocket (not server.accept) is what opts this object into
    // hibernation: the runtime keeps the socket while evicting us.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      peerId: crypto.randomUUID(),
      ...(assignedCode !== null ? { assignedCode } : {}),
    } satisfies Attachment);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const att = this.attachment(ws);
    if (!att) return;

    const raw =
      typeof message === "string" ? message : new TextDecoder().decode(message);

    const core = this.rooms();
    const keepOpen = core.handleMessage(this.connection(ws, att.peerId), raw);

    // The role is only known once CREATE_ROOM / JOIN_ROOM has been handled.
    // Persist it so a wake can rebuild the routing table.
    const mem = core.membershipOf(att.peerId);
    if (mem && (att.roomId !== mem.roomId || att.role !== mem.role)) {
      ws.serializeAttachment({
        ...att,
        roomId: mem.roomId,
        role: mem.role,
      } satisfies Attachment);
    }

    // A connection that trips the rate limit is dropped to shed abusive load.
    if (!keepOpen) ws.close(1008, "Rate limited");
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
  ): Promise<void> {
    this.drop(ws);

    // Complete the closing handshake. When a client calls close(), the
    // hibernation API hands us the frame and expects *us* to close our side; if
    // we don't, the client sits in CLOSING until its own timeout and never gets
    // an onclose. That is what made a wrong room code look like an endless
    // "connecting" instead of a prompt, explainable failure.
    //
    // 1005 (no status) and 1006 (abnormal) are not sendable on the wire.
    try {
      const sendable = code >= 1000 && code !== 1005 && code !== 1006;
      if (sendable) ws.close(code, reason);
      else ws.close();
    } catch {
      // Already closed from the other side; nothing to complete.
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.drop(ws);
  }

  private drop(ws: WebSocket): void {
    const att = this.attachment(ws);
    if (!att) return;
    this.rooms().handleClose(this.connection(ws, att.peerId));
  }
}
