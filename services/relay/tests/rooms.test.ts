import { describe, expect, test } from "bun:test";
import {
  RelayRooms,
  RelayMessageTypes,
  RelayErrorCodes,
  MAX_MESSAGE_BYTES,
  generateRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
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

describe("room code case", () => {
  test("a room created upper-case is joinable lower-case", () => {
    // Codes are read off a TV and retyped or re-scanned on a phone; some
    // scanners and keyboards change the case. The room must be the same room.
    const rooms = new RelayRooms();
    const host = conn("h");
    const player = conn("p");

    rooms.handleMessage(host, JSON.stringify({ type: "CREATE_ROOM", roomId: "6DX8" }));
    rooms.handleMessage(player, JSON.stringify({ type: "JOIN_ROOM", roomId: "6dx8" }));

    expect(player.sent[0].type).toBe(RelayMessageTypes.ROOM_JOINED);
    expect(host.sent[1]).toMatchObject({ type: RelayMessageTypes.PEER_JOINED, peerId: "p" });
  });

  test("a room created lower-case is joinable upper-case", () => {
    const rooms = new RelayRooms();
    const host = conn("h");
    const player = conn("p");

    rooms.handleMessage(host, JSON.stringify({ type: "CREATE_ROOM", roomId: "abcd" }));
    rooms.handleMessage(player, JSON.stringify({ type: "JOIN_ROOM", roomId: "ABCD" }));

    expect(player.sent[0].type).toBe(RelayMessageTypes.ROOM_JOINED);
  });

  test("codes differing only by case are the same room, not two", () => {
    const rooms = new RelayRooms();
    const first = conn("h1");
    const second = conn("h2");

    rooms.handleMessage(first, JSON.stringify({ type: "CREATE_ROOM", roomId: "ABCD" }));
    rooms.handleMessage(second, JSON.stringify({ type: "CREATE_ROOM", roomId: "abcd" }));

    expect(second.sent[0].code).toBe(RelayErrorCodes.ROOM_EXISTS);
    expect(rooms.roomCount).toBe(1);
  });

  test("membership and routing use the canonical code", () => {
    const rooms = new RelayRooms();
    const host = conn("h");
    const player = conn("p");
    rooms.handleMessage(host, JSON.stringify({ type: "CREATE_ROOM", roomId: "xy12" }));
    rooms.handleMessage(player, JSON.stringify({ type: "JOIN_ROOM", roomId: "XY12" }));

    expect(rooms.membershipOf("h")).toEqual({ roomId: "XY12", role: "host" });
    expect(rooms.membershipOf("p")).toEqual({ roomId: "XY12", role: "player" });

    host.sent.length = 0;
    player.sent.length = 0;
    rooms.handleMessage(host, JSON.stringify({ type: "DATA", data: "s" }));
    expect(player.sent[0]).toMatchObject({ type: RelayMessageTypes.DATA, data: "s" });
  });
});

describe("minted room codes", () => {
  const create = (rooms: RelayRooms, c: ReturnType<typeof conn>) =>
    rooms.handleMessage(c, JSON.stringify({ type: "CREATE_ROOM" }));

  test("a CREATE_ROOM with no code gets one from the relay", () => {
    const rooms = new RelayRooms();
    const host = conn("h");
    create(rooms, host);

    expect(rooms.roomCount).toBe(1);
    expect(host.sent).toHaveLength(1);
    expect(host.sent[0].type).toBe(RelayMessageTypes.ROOM_CREATED);
    // The host has no other way to learn the code, so it must come back here.
    expect(host.sent[0].roomId).toMatch(
      new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`),
    );
  });

  test("players can join a minted code", () => {
    const rooms = new RelayRooms();
    const host = conn("h");
    create(rooms, host);
    const code = host.sent[0].roomId;

    const player = conn("p");
    rooms.handleMessage(
      player,
      JSON.stringify({ type: "JOIN_ROOM", roomId: code }),
    );
    expect(player.sent[0]).toEqual({
      type: RelayMessageTypes.ROOM_JOINED,
      roomId: code,
      peerId: "p",
    });
  });

  test("minted codes are case-insensitive to join, like typed ones", () => {
    const rooms = new RelayRooms();
    const host = conn("h");
    create(rooms, host);

    const player = conn("p");
    rooms.handleMessage(
      player,
      JSON.stringify({
        type: "JOIN_ROOM",
        roomId: host.sent[0].roomId.toLowerCase(),
      }),
    );
    expect(player.sent[0].type).toBe(RelayMessageTypes.ROOM_JOINED);
  });

  test("does not hand the same code to two rooms", () => {
    const rooms = new RelayRooms({ maxRooms: 200 });
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const host = conn(`h${i}`);
      create(rooms, host);
      codes.add(host.sent[0].roomId);
    }
    expect(codes.size).toBe(200);
    expect(rooms.roomCount).toBe(200);
  });

  test("a relay that cannot find a free code says so instead of colliding", () => {
    // Mint hook that always returns a code already in use, standing in for a
    // keyspace so full that every candidate collides.
    const rooms = new RelayRooms({}, Date.now, () => null);
    const host = conn("h");
    create(rooms, host);

    expect(rooms.roomCount).toBe(0);
    expect(host.sent[0]).toMatchObject({
      type: RelayMessageTypes.ERROR,
      code: RelayErrorCodes.SERVER_BUSY,
    });
  });

  test("a caller-supplied code still works, and still collides", () => {
    const rooms = new RelayRooms();
    rooms.handleMessage(
      conn("h"),
      JSON.stringify({ type: "CREATE_ROOM", roomId: "FIXED" }),
    );
    const second = conn("h2");
    rooms.handleMessage(
      second,
      JSON.stringify({ type: "CREATE_ROOM", roomId: "FIXED" }),
    );
    expect(second.sent[0]).toMatchObject({
      code: RelayErrorCodes.ROOM_EXISTS,
    });
  });
});

describe("generateRoomCode", () => {
  test("uses only unambiguous characters", () => {
    for (let i = 0; i < 200; i++) {
      // O/0 and I/1 are the pairs people misread off a TV.
      expect(generateRoomCode()).not.toMatch(/[O0I1]/);
    }
  });

  test("does not repeat itself", () => {
    const codes = new Set(
      Array.from({ length: 1000 }, () => generateRoomCode()),
    );
    // Birthday collisions at 1000 draws from 32^6 are ~0.0005% likely.
    expect(codes.size).toBe(1000);
  });
});
