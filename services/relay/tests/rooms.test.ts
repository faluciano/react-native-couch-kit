import { describe, expect, test } from "bun:test";
import {
  RelayRooms,
  RelayMessageTypes,
  RelayErrorCodes,
  MAX_MESSAGE_BYTES,
  type RelayConnection,
} from "../src/rooms";

/** A fake connection that records everything sent to it. */
function conn(id: string): RelayConnection & { sent: any[] } {
  const sent: any[] = [];
  return {
    id,
    sent,
    send(data: string) {
      sent.push(JSON.parse(data));
    },
  };
}

const dataMsg = (data: string, to?: string) =>
  JSON.stringify({ type: RelayMessageTypes.DATA, roomId: "R", to, data });

describe("RelayRooms", () => {
  test("host creates a room and is acknowledged", () => {
    const rooms = new RelayRooms();
    const host = conn("h");
    rooms.handleMessage(host, JSON.stringify({ type: "CREATE_ROOM", roomId: "R" }));

    expect(rooms.roomCount).toBe(1);
    expect(host.sent).toEqual([
      { type: RelayMessageTypes.ROOM_CREATED, roomId: "R", peerId: "h" },
    ]);
  });

  test("duplicate room creation is rejected", () => {
    const rooms = new RelayRooms();
    rooms.handleMessage(conn("h"), JSON.stringify({ type: "CREATE_ROOM", roomId: "R" }));
    const h2 = conn("h2");
    rooms.handleMessage(h2, JSON.stringify({ type: "CREATE_ROOM", roomId: "R" }));
    expect(h2.sent[0].code).toBe(RelayErrorCodes.ROOM_EXISTS);
  });

  test("joining unknown room errors", () => {
    const rooms = new RelayRooms();
    const p = conn("p");
    rooms.handleMessage(p, JSON.stringify({ type: "JOIN_ROOM", roomId: "nope" }));
    expect(p.sent[0].code).toBe(RelayErrorCodes.ROOM_NOT_FOUND);
  });

  test("player join notifies host and joiner", () => {
    const rooms = new RelayRooms();
    const host = conn("h");
    rooms.handleMessage(host, JSON.stringify({ type: "CREATE_ROOM", roomId: "R" }));
    const p = conn("p");
    rooms.handleMessage(p, JSON.stringify({ type: "JOIN_ROOM", roomId: "R" }));

    expect(p.sent).toContainEqual({
      type: RelayMessageTypes.ROOM_JOINED,
      roomId: "R",
      peerId: "p",
    });
    expect(host.sent).toContainEqual({
      type: RelayMessageTypes.PEER_JOINED,
      roomId: "R",
      peerId: "p",
    });
  });

  test("player DATA is routed to host tagged with sender id", () => {
    const rooms = new RelayRooms();
    const host = conn("h");
    rooms.handleMessage(host, JSON.stringify({ type: "CREATE_ROOM", roomId: "R" }));
    const p = conn("p");
    rooms.handleMessage(p, JSON.stringify({ type: "JOIN_ROOM", roomId: "R" }));
    host.sent.length = 0;

    rooms.handleMessage(p, dataMsg('{"type":"ACTION"}'));
    expect(host.sent).toEqual([
      {
        type: RelayMessageTypes.DATA,
        roomId: "R",
        from: "p",
        data: '{"type":"ACTION"}',
      },
    ]);
  });

  test("host unicast reaches only the addressed player", () => {
    const rooms = new RelayRooms();
    const host = conn("h");
    rooms.handleMessage(host, JSON.stringify({ type: "CREATE_ROOM", roomId: "R" }));
    const p1 = conn("p1");
    const p2 = conn("p2");
    rooms.handleMessage(p1, JSON.stringify({ type: "JOIN_ROOM", roomId: "R" }));
    rooms.handleMessage(p2, JSON.stringify({ type: "JOIN_ROOM", roomId: "R" }));
    p1.sent.length = 0;
    p2.sent.length = 0;

    rooms.handleMessage(host, dataMsg('{"type":"WELCOME"}', "p1"));
    expect(p1.sent).toHaveLength(1);
    expect(p2.sent).toHaveLength(0);
  });

  test("host broadcast reaches all players", () => {
    const rooms = new RelayRooms();
    const host = conn("h");
    rooms.handleMessage(host, JSON.stringify({ type: "CREATE_ROOM", roomId: "R" }));
    const p1 = conn("p1");
    const p2 = conn("p2");
    rooms.handleMessage(p1, JSON.stringify({ type: "JOIN_ROOM", roomId: "R" }));
    rooms.handleMessage(p2, JSON.stringify({ type: "JOIN_ROOM", roomId: "R" }));
    p1.sent.length = 0;
    p2.sent.length = 0;

    rooms.handleMessage(host, dataMsg('{"type":"STATE_UPDATE"}'));
    expect(p1.sent).toHaveLength(1);
    expect(p2.sent).toHaveLength(1);
  });

  test("player disconnect notifies host with PEER_LEFT", () => {
    const rooms = new RelayRooms();
    const host = conn("h");
    rooms.handleMessage(host, JSON.stringify({ type: "CREATE_ROOM", roomId: "R" }));
    const p = conn("p");
    rooms.handleMessage(p, JSON.stringify({ type: "JOIN_ROOM", roomId: "R" }));
    host.sent.length = 0;

    rooms.handleClose(p);
    expect(host.sent).toEqual([
      { type: RelayMessageTypes.PEER_LEFT, roomId: "R", peerId: "p" },
    ]);
  });

  test("host disconnect tears down the room", () => {
    const rooms = new RelayRooms();
    const host = conn("h");
    rooms.handleMessage(host, JSON.stringify({ type: "CREATE_ROOM", roomId: "R" }));
    const p = conn("p");
    rooms.handleMessage(p, JSON.stringify({ type: "JOIN_ROOM", roomId: "R" }));

    rooms.handleClose(host);
    expect(rooms.roomCount).toBe(0);
    // The former player is now orphaned; its DATA is rejected.
    p.sent.length = 0;
    rooms.handleMessage(p, dataMsg("{}"));
    expect(p.sent[0].code).toBe(RelayErrorCodes.NOT_IN_ROOM);
  });

  test("oversized messages are rejected", () => {
    const rooms = new RelayRooms();
    const c = conn("c");
    const huge = "x".repeat(MAX_MESSAGE_BYTES + 1);
    rooms.handleMessage(c, huge);
    expect(c.sent[0].code).toBe(RelayErrorCodes.MESSAGE_TOO_LARGE);
  });

  test("malformed JSON is rejected", () => {
    const rooms = new RelayRooms();
    const c = conn("c");
    rooms.handleMessage(c, "{not json");
    expect(c.sent[0].code).toBe(RelayErrorCodes.MALFORMED);
  });

  test("handleMessage returns true for well-behaved traffic", () => {
    const rooms = new RelayRooms();
    const host = conn("h");
    const keepOpen = rooms.handleMessage(
      host,
      JSON.stringify({ type: "CREATE_ROOM", roomId: "R" }),
    );
    expect(keepOpen).toBe(true);
  });

  test("exceeding the message rate limit errors and signals disconnect", () => {
    const rooms = new RelayRooms({ messagesPerWindow: 3, rateWindowMs: 1000 });
    const c = conn("c");
    // Unknown-type messages still count toward the rate limit.
    const noop = JSON.stringify({ type: "NOPE" });
    expect(rooms.handleMessage(c, noop)).toBe(true);
    expect(rooms.handleMessage(c, noop)).toBe(true);
    expect(rooms.handleMessage(c, noop)).toBe(true);
    // 4th within the window trips the limit.
    expect(rooms.handleMessage(c, noop)).toBe(false);
    expect(c.sent.at(-1).code).toBe(RelayErrorCodes.RATE_LIMITED);
  });

  test("rate limit window slides as time advances", () => {
    let t = 0;
    const rooms = new RelayRooms(
      { messagesPerWindow: 2, rateWindowMs: 1000 },
      () => t,
    );
    const c = conn("c");
    const noop = JSON.stringify({ type: "NOPE" });
    expect(rooms.handleMessage(c, noop)).toBe(true);
    expect(rooms.handleMessage(c, noop)).toBe(true);
    t = 1001; // old hits fall out of the window
    expect(rooms.handleMessage(c, noop)).toBe(true);
  });

  test("room creation is capped at maxRooms", () => {
    const rooms = new RelayRooms({ maxRooms: 1 });
    rooms.handleMessage(conn("h1"), JSON.stringify({ type: "CREATE_ROOM", roomId: "A" }));
    const h2 = conn("h2");
    rooms.handleMessage(h2, JSON.stringify({ type: "CREATE_ROOM", roomId: "B" }));
    expect(h2.sent[0].code).toBe(RelayErrorCodes.SERVER_BUSY);
    expect(rooms.roomCount).toBe(1);
  });

  test("joining a full room is rejected with ROOM_FULL", () => {
    const rooms = new RelayRooms({ maxPlayersPerRoom: 1 });
    rooms.handleMessage(conn("h"), JSON.stringify({ type: "CREATE_ROOM", roomId: "R" }));
    rooms.handleMessage(conn("p1"), JSON.stringify({ type: "JOIN_ROOM", roomId: "R" }));
    const p2 = conn("p2");
    rooms.handleMessage(p2, JSON.stringify({ type: "JOIN_ROOM", roomId: "R" }));
    expect(p2.sent[0].code).toBe(RelayErrorCodes.ROOM_FULL);
  });

  test("membershipOf reports room and role, and clears on close", () => {
    const rooms = new RelayRooms();
    const host = conn("h");
    const player = conn("p");
    rooms.handleMessage(host, JSON.stringify({ type: "CREATE_ROOM", roomId: "R" }));
    rooms.handleMessage(player, JSON.stringify({ type: "JOIN_ROOM", roomId: "R" }));

    expect(rooms.membershipOf("h")).toEqual({ roomId: "R", role: "host" });
    expect(rooms.membershipOf("p")).toEqual({ roomId: "R", role: "player" });
    expect(rooms.membershipOf("nobody")).toBeUndefined();

    rooms.handleClose(player);
    expect(rooms.membershipOf("p")).toBeUndefined();
  });

  test("restore rebuilds routing for existing connections without notifying them", () => {
    // Models a Durable Object waking from hibernation: the sockets are still
    // open, but this routing table was evicted and must be rebuilt from them.
    const rooms = new RelayRooms({ maxRooms: 1 });
    const host = conn("h");
    const p1 = conn("p1");
    const p2 = conn("p2");

    rooms.restore([
      { conn: host, roomId: "R", role: "host" },
      { conn: p1, roomId: "R", role: "player" },
      { conn: p2, roomId: "R", role: "player" },
    ]);

    // Nothing is re-announced to clients that already know they are connected.
    expect(host.sent).toEqual([]);
    expect(p1.sent).toEqual([]);

    // Routing works immediately: broadcast reaches every restored player.
    rooms.handleMessage(host, JSON.stringify({ type: "DATA", data: "s" }));
    expect(p1.sent[0]).toMatchObject({ type: RelayMessageTypes.DATA, data: "s" });
    expect(p2.sent[0]).toMatchObject({ type: RelayMessageTypes.DATA, data: "s" });

    // And player -> host still carries the sender id.
    rooms.handleMessage(p1, JSON.stringify({ type: "DATA", data: "a" }));
    expect(host.sent[0]).toMatchObject({ from: "p1", data: "a" });
  });

  test("restore tolerates players listed before their host", () => {
    const rooms = new RelayRooms({ maxRooms: 1 });
    const host = conn("h");
    const player = conn("p");
    rooms.restore([
      { conn: player, roomId: "R", role: "player" },
      { conn: host, roomId: "R", role: "host" },
    ]);

    rooms.handleMessage(host, JSON.stringify({ type: "DATA", data: "x" }));
    expect(player.sent[0]).toMatchObject({ data: "x" });
  });

  test("restore leaves a room joinable and closable as normal", () => {
    const rooms = new RelayRooms({ maxRooms: 1 });
    const host = conn("h");
    const p1 = conn("p1");
    rooms.restore([
      { conn: host, roomId: "R", role: "host" },
      { conn: p1, roomId: "R", role: "player" },
    ]);

    const late = conn("p2");
    rooms.handleMessage(late, JSON.stringify({ type: "JOIN_ROOM", roomId: "R" }));
    expect(late.sent[0].type).toBe(RelayMessageTypes.ROOM_JOINED);
    expect(host.sent[0]).toMatchObject({ type: RelayMessageTypes.PEER_JOINED, peerId: "p2" });

    host.sent.length = 0;
    rooms.handleClose(p1);
    expect(host.sent[0]).toMatchObject({ type: RelayMessageTypes.PEER_LEFT, peerId: "p1" });
  });

  test("closing a connection clears its rate-limit state", () => {
    const rooms = new RelayRooms({ messagesPerWindow: 2, rateWindowMs: 1000 });
    const c = conn("c");
    const noop = JSON.stringify({ type: "NOPE" });
    rooms.handleMessage(c, noop);
    rooms.handleMessage(c, noop);
    rooms.handleClose(c);
    // Fresh budget after reconnect (same id): first message is allowed again.
    expect(rooms.handleMessage(c, noop)).toBe(true);
  });
});
