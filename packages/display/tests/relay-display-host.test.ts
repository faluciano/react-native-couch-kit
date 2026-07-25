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
