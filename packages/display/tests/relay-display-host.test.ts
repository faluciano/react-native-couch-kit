import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import type { IGameState, IAction } from "@couch-kit/core";
import { RelayMessageTypes } from "@couch-kit/client";
import { RelayDisplayHost } from "../src/relay-display-host";

// --- Minimal game under test ---------------------------------------------

interface TestState extends IGameState {
  score: number;
}
type TestAction = IAction & { type: "BUMP" };

const initialState: TestState = { status: "lobby", players: {}, score: 0 };
const reducer = (state: TestState, action: { type: string }): TestState =>
  action.type === "BUMP" ? { ...state, score: state.score + 1 } : state;

// A valid session secret: >=32 hex chars (dashes ignored).
const SECRET = "11111111-1111-1111-1111-111111111111";

// --- Mock WebSocket ------------------------------------------------------

class MockWebSocket {
  static last: MockWebSocket | null = null;
  url: string;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.last = this;
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }

  // Test helpers to simulate the wire.
  open(): void {
    this.onopen?.();
  }
  fromServer(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  fromServerRaw(data: string): void {
    this.onmessage?.({ data });
  }

  /** Parsed frames this side sent, optionally filtered to relay DATA. */
  frames(): any[] {
    return this.sent.map((s) => JSON.parse(s));
  }
  /** Inner game messages carried by DATA envelopes (with `to` addressing). */
  dataMessages(): { to?: string; msg: any }[] {
    return this.frames()
      .filter((f) => f.type === RelayMessageTypes.DATA)
      .map((f) => ({ to: f.to, msg: JSON.parse(f.data) }));
  }
}

const flush = (ms = 30) => new Promise((r) => setTimeout(r, ms));

let originalWebSocket: unknown;
beforeEach(() => {
  originalWebSocket = (globalThis as any).WebSocket;
  (globalThis as any).WebSocket = MockWebSocket;
  MockWebSocket.last = null;
});
afterEach(() => {
  (globalThis as any).WebSocket = originalWebSocket;
});

function makeHost(onError?: (e: Error) => void) {
  const host = new RelayDisplayHost<TestState, TestAction>({
    url: "wss://relay.test",
    roomId: "ROOM",
    reducer,
    initialState,
    // Broadcast promptly so tests don't race the ~33ms default throttle.
    stateThrottleMs: 1,
    ...(onError ? { onError } : {}),
  });
  const ws = MockWebSocket.last!;
  return { host, ws };
}

describe("RelayDisplayHost", () => {
  test("creates the room when the socket opens", () => {
    const { ws } = makeHost();
    ws.open();
    expect(ws.frames()).toEqual([
      { type: RelayMessageTypes.CREATE_ROOM, roomId: "ROOM" },
    ]);
  });

  test("exposes the initial authoritative state", () => {
    const { host } = makeHost();
    expect(host.getState()).toEqual(initialState);
  });

  test("a phone JOIN is welcomed as a unicast envelope to that peer", async () => {
    const { ws } = makeHost();
    ws.open();
    ws.sent.length = 0;

    ws.fromServer({ type: RelayMessageTypes.PEER_JOINED, roomId: "ROOM", peerId: "p1" });
    ws.fromServer({
      type: RelayMessageTypes.DATA,
      roomId: "ROOM",
      from: "p1",
      data: JSON.stringify({ type: "JOIN", payload: { secret: SECRET, name: "P1" } }),
    });
    await flush();

    const welcome = ws.dataMessages().find((d) => d.msg.type === "WELCOME");
    expect(welcome).toBeDefined();
    expect(welcome!.to).toBe("p1");
  });

  test("dispatch broadcasts a STATE_UPDATE envelope to the room", async () => {
    const { host, ws } = makeHost();
    ws.open();
    ws.sent.length = 0;

    host.dispatch({ type: "BUMP" });
    await flush();

    const broadcast = ws
      .dataMessages()
      .find((d) => d.msg.type === "STATE_UPDATE" && d.to === undefined);
    expect(broadcast).toBeDefined();
    expect(host.getState().score).toBe(1);
  });

  test("notifies subscribers on state change", () => {
    const { host } = makeHost();
    let calls = 0;
    const unsub = host.subscribe(() => {
      calls++;
    });
    host.dispatch({ type: "BUMP" });
    expect(calls).toBe(1);
    unsub();
    host.dispatch({ type: "BUMP" });
    expect(calls).toBe(1);
  });

  test("PEER_LEFT disconnects the peer without error", async () => {
    const { ws } = makeHost();
    ws.open();
    ws.fromServer({ type: RelayMessageTypes.PEER_JOINED, roomId: "ROOM", peerId: "p1" });
    expect(() =>
      ws.fromServer({ type: RelayMessageTypes.PEER_LEFT, roomId: "ROOM", peerId: "p1" }),
    ).not.toThrow();
  });

  test("oversized inbound data is dropped, not forwarded to the runtime", async () => {
    const { ws } = makeHost();
    ws.open();
    ws.fromServer({ type: RelayMessageTypes.PEER_JOINED, roomId: "ROOM", peerId: "p1" });
    ws.sent.length = 0;

    const huge = "x".repeat(256 * 1024 + 1);
    ws.fromServer({
      type: RelayMessageTypes.DATA,
      roomId: "ROOM",
      from: "p1",
      data: JSON.stringify({ type: "JOIN", payload: { secret: SECRET, name: huge } }),
    });
    await flush();
    // Nothing sent back: the frame never reached the runtime.
    expect(ws.sent).toHaveLength(0);
  });

  test("unparseable inbound data is ignored", async () => {
    const { ws } = makeHost();
    ws.open();
    ws.fromServer({ type: RelayMessageTypes.PEER_JOINED, roomId: "ROOM", peerId: "p1" });
    ws.sent.length = 0;

    expect(() =>
      ws.fromServer({ type: RelayMessageTypes.DATA, roomId: "ROOM", from: "p1", data: "{bad" }),
    ).not.toThrow();
    await flush();
    expect(ws.sent).toHaveLength(0);
  });

  test("a non-JSON relay frame is ignored", () => {
    const { ws } = makeHost();
    ws.open();
    expect(() => ws.fromServerRaw("not json")).not.toThrow();
  });

  test("a relay ERROR message surfaces to onError", () => {
    const errors: Error[] = [];
    const { ws } = makeHost((e) => errors.push(e));
    ws.open();
    ws.fromServer({ type: RelayMessageTypes.ERROR, code: "ROOM_EXISTS", message: "boom" });
    expect(errors.map((e) => e.message)).toContain("boom");
  });

  test("a socket error surfaces to onError", () => {
    const errors: Error[] = [];
    const { ws } = makeHost((e) => errors.push(e));
    ws.onerror?.(new Error("socket down"));
    expect(errors.map((e) => e.message)).toContain("socket down");
  });

  test("stop() closes the socket", () => {
    const { host, ws } = makeHost();
    ws.open();
    host.stop();
    expect(ws.closed).toBe(true);
  });
});

/**
 * A projected game re-sends every player's own view on each state change. Those
 * go out as one `DATA_MULTI` frame rather than one frame per player, because a
 * relay bills and rate-limits per inbound frame.
 */
describe("projected state updates", () => {
  interface HandState extends IGameState {
    hands: Record<string, string>;
  }

  function makeProjectedHost(project: (s: HandState, id: string) => unknown) {
    const host = new RelayDisplayHost<HandState, TestAction>({
      url: "wss://relay.test",
      roomId: "ROOM",
      reducer: (state) => ({ ...state, hands: { ...state.hands } }),
      initialState: { status: "lobby", players: {}, hands: { seat: "ACE" } },
      project,
      stateThrottleMs: 1,
    });
    return { host, ws: MockWebSocket.last! };
  }

  /** Brings a phone all the way to joined, so it is in `joinedConnections`. */
  async function join(ws: MockWebSocket, peerId: string) {
    ws.fromServer({ type: RelayMessageTypes.PEER_JOINED, roomId: "ROOM", peerId });
    ws.fromServer({
      type: RelayMessageTypes.DATA,
      roomId: "ROOM",
      from: peerId,
      // A distinct secret per phone, or the second one resumes the first's
      // session instead of taking a seat of its own.
      data: JSON.stringify({
        type: "JOIN",
        payload: { secret: peerId.slice(-1).repeat(32), name: peerId },
      }),
    });
    await flush();
  }

  const multiFrames = (ws: MockWebSocket) =>
    ws.frames().filter((f) => f.type === RelayMessageTypes.DATA_MULTI);

  test("two players cost one frame, keyed by peer id", async () => {
    const { host, ws } = makeProjectedHost((state, id) => ({ ...state, me: id }));
    ws.open();
    await join(ws, "p1");
    await join(ws, "p2");
    ws.sent.length = 0;

    host.dispatch({ type: "BUMP" });
    await flush();

    const frames = multiFrames(ws);
    expect(frames).toHaveLength(1);
    expect(Object.keys(frames[0].payloads).sort()).toEqual(["p1", "p2"]);
    // And no per-player DATA frames alongside it.
    expect(ws.dataMessages().filter((d) => d.msg.type === "STATE_UPDATE")).toEqual([]);
  });

  test("each payload carries that player's own projection", async () => {
    const { host, ws } = makeProjectedHost((state, id) => ({ ...state, me: id }));
    ws.open();
    await join(ws, "p1");
    await join(ws, "p2");
    ws.sent.length = 0;

    host.dispatch({ type: "BUMP" });
    await flush();

    const { payloads } = multiFrames(ws)[0];
    // The projection is keyed off the player id, not the peer id, so assert the
    // two phones got *different* views rather than guessing the id.
    expect(payloads.p1).not.toEqual(payloads.p2);
  });

  test("falls back to per-player frames when the batch would be rejected", async () => {
    // Each view fits the relay's 256KB ceiling; two in one envelope do not.
    const bulk = "x".repeat(200 * 1024);
    const { host, ws } = makeProjectedHost((state) => ({ ...state, bulk }));
    ws.open();
    await join(ws, "p1");
    await join(ws, "p2");
    ws.sent.length = 0;

    host.dispatch({ type: "BUMP" });
    await flush();

    // Splitting costs an extra billed message; being dropped by the relay would
    // cost the game.
    expect(multiFrames(ws)).toHaveLength(0);
    const updates = ws.dataMessages().filter((d) => d.msg.type === "STATE_UPDATE");
    expect(updates.map((u) => u.to).sort()).toEqual(["p1", "p2"]);
  });
});

describe("relay-assigned room codes", () => {
  /** A host that lets the relay pick the code. */
  function makeMintingHost() {
    const codes: string[] = [];
    const host = new RelayDisplayHost<TestState, TestAction>({
      url: "wss://relay.test",
      onRoomCode: (code) => codes.push(code),
      reducer,
      initialState,
      stateThrottleMs: 1,
    });
    return { host, ws: MockWebSocket.last!, codes };
  }

  test("addresses the mint path when no code is supplied", () => {
    const { ws } = makeMintingHost();
    // A sharded relay picks the object before reading any frame, so "give me a
    // room" has to be visible in the URL and cannot look like a room code.
    expect(ws.url).toBe("wss://relay.test/new");
  });

  test("asks the relay to choose, rather than naming a code", () => {
    const { ws } = makeMintingHost();
    ws.open();
    // An absent roomId is what the relay reads as "you pick"; sending null or
    // an empty string would be rejected as malformed.
    expect(ws.frames()).toEqual([{ type: RelayMessageTypes.CREATE_ROOM }]);
  });

  test("reports the code once the relay assigns it", () => {
    const { host, ws, codes } = makeMintingHost();
    ws.open();
    expect(host.roomCode).toBeNull();

    ws.fromServer({
      type: RelayMessageTypes.ROOM_CREATED,
      roomId: "K7M2QX",
      peerId: "h",
    });

    expect(codes).toEqual(["K7M2QX"]);
    expect(host.roomCode).toBe("K7M2QX");
  });

  test("still addresses a caller-supplied code directly", () => {
    const { host, ws } = makeHost();
    expect(ws.url).toBe("wss://relay.test/r/ROOM");
    expect(host.roomCode).toBe("ROOM");
  });

  test("confirms a caller-supplied code when the relay acknowledges it", () => {
    const seen: string[] = [];
    const host = new RelayDisplayHost<TestState, TestAction>({
      url: "wss://relay.test",
      roomId: "ROOM",
      onRoomCode: (code) => seen.push(code),
      reducer,
      initialState,
      stateThrottleMs: 1,
    });
    const ws = MockWebSocket.last!;
    ws.open();
    ws.fromServer({
      type: RelayMessageTypes.ROOM_CREATED,
      roomId: "ROOM",
      peerId: "h",
    });

    expect(seen).toEqual(["ROOM"]);
    expect(host.roomCode).toBe("ROOM");
  });

  test("routes game traffic under the assigned code", async () => {
    const { ws } = makeMintingHost();
    ws.open();
    ws.fromServer({
      type: RelayMessageTypes.ROOM_CREATED,
      roomId: "K7M2QX",
      peerId: "h",
    });
    ws.sent.length = 0;

    // Nothing is sent before the room exists, so every envelope carries the
    // minted code rather than the placeholder it started with.
    ws.fromServer({
      type: RelayMessageTypes.PEER_JOINED,
      roomId: "K7M2QX",
      peerId: "p1",
    });
    ws.fromServer({
      type: RelayMessageTypes.DATA,
      roomId: "K7M2QX",
      from: "p1",
      data: JSON.stringify({
        type: "JOIN",
        payload: { secret: SECRET, name: "P1" },
      }),
    });
    await flush();

    const envelopes = ws.frames().filter((f) => f.type === RelayMessageTypes.DATA);
    expect(envelopes.length).toBeGreaterThan(0);
    for (const envelope of envelopes) {
      expect(envelope.roomId).toBe("K7M2QX");
    }
  });
});
