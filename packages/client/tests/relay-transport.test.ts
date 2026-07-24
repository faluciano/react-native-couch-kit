import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  RelayClientTransport,
  createRelayTransport,
} from "../src/relay-transport";
import { TransportReadyState } from "../src/transport";
import { RelayMessageTypes } from "../src/relay-protocol";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static last(): MockWebSocket {
    return this.instances[this.instances.length - 1];
  }
  url: string;
  readyState = TransportReadyState.CONNECTING;
  sent: string[] = [];
  closed: { code?: number; reason?: string } | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason };
  }
  fireOpen() {
    this.readyState = TransportReadyState.OPEN;
    this.onopen?.();
  }
  fireMessage(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  fireClose(code: number, reason?: string) {
    this.onclose?.({ code, reason });
  }
}

let original: unknown;
beforeEach(() => {
  MockWebSocket.instances = [];
  original = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket = MockWebSocket;
});
afterEach(() => {
  (globalThis as { WebSocket?: unknown }).WebSocket = original;
});

const joined = (roomId = "R", peerId = "p") => ({
  type: RelayMessageTypes.ROOM_JOINED,
  roomId,
  peerId,
});

describe("RelayClientTransport", () => {
  test("sends JOIN_ROOM once the relay socket opens", () => {
    new RelayClientTransport({ url: "ws://relay", roomId: "R" });
    const ws = MockWebSocket.last();
    expect(ws.url).toBe("ws://relay");

    ws.fireOpen();
    expect(JSON.parse(ws.sent[0])).toEqual({
      type: RelayMessageTypes.JOIN_ROOM,
      roomId: "R",
    });
  });

  test("stays CONNECTING until ROOM_JOINED, then opens", () => {
    const t = new RelayClientTransport({ url: "ws://relay", roomId: "R" });
    const ws = MockWebSocket.last();
    let opened = false;
    t.onopen = () => (opened = true);

    ws.fireOpen();
    expect(t.readyState).toBe(TransportReadyState.CONNECTING);
    expect(opened).toBe(false);

    ws.fireMessage(joined());
    expect(t.readyState).toBe(TransportReadyState.OPEN);
    expect(opened).toBe(true);
  });

  test("wraps outbound messages in a DATA envelope (only when open)", () => {
    const t = new RelayClientTransport({ url: "ws://relay", roomId: "R" });
    const ws = MockWebSocket.last();
    ws.fireOpen();

    // Before ROOM_JOINED, sends are dropped.
    t.send('{"type":"ACTION"}');
    expect(ws.sent).toHaveLength(1); // just JOIN_ROOM

    ws.fireMessage(joined());
    t.send('{"type":"ACTION"}');
    expect(JSON.parse(ws.sent[1])).toEqual({
      type: RelayMessageTypes.DATA,
      roomId: "R",
      data: '{"type":"ACTION"}',
    });
  });

  test("unwraps inbound DATA to onmessage", () => {
    const t = new RelayClientTransport({ url: "ws://relay", roomId: "R" });
    const ws = MockWebSocket.last();
    ws.fireOpen();
    ws.fireMessage(joined());

    let got: string | null = null;
    t.onmessage = (data) => (got = data);
    ws.fireMessage({
      type: RelayMessageTypes.DATA,
      roomId: "R",
      data: '{"type":"WELCOME"}',
    });
    expect(got).toBe('{"type":"WELCOME"}');
  });

  test("relay ERROR is surfaced as a terminal (1008) close", () => {
    const t = new RelayClientTransport({ url: "ws://relay", roomId: "R" });
    const ws = MockWebSocket.last();
    ws.fireOpen();

    let closeCode: number | null = null;
    t.onclose = (code) => (closeCode = code);

    ws.fireMessage({
      type: RelayMessageTypes.ERROR,
      code: "ROOM_NOT_FOUND",
      message: "nope",
    });
    // The transport closes the underlying socket...
    expect(ws.closed).not.toBeNull();
    // ...and reports 1008 regardless of the raw socket close code.
    ws.fireClose(1005);
    expect(closeCode).toBe(1008);
  });

  test("an unexpected socket close is reported as recoverable", () => {
    const t = new RelayClientTransport({ url: "ws://relay", roomId: "R" });
    const ws = MockWebSocket.last();
    ws.fireOpen();
    ws.fireMessage(joined());

    let closeCode: number | null = null;
    t.onclose = (code) => (closeCode = code);
    ws.fireClose(1006);
    expect(closeCode).toBe(1006);
    expect(t.readyState).toBe(TransportReadyState.CLOSED);
  });

  test("close() only forwards reserved-safe codes to the socket", () => {
    const t1 = new RelayClientTransport({ url: "ws://relay", roomId: "R" });
    const ws1 = MockWebSocket.last();
    t1.close(1000, "done");
    expect(ws1.closed).toEqual({ code: 1000, reason: "done" });

    const t2 = new RelayClientTransport({ url: "ws://relay", roomId: "R" });
    const ws2 = MockWebSocket.last();
    t2.close(1008); // reserved — not allowed on WebSocket.close
    expect(ws2.closed).toEqual({ code: undefined, reason: undefined });
  });

  test("createRelayTransport returns a fresh transport each call", () => {
    const factory = createRelayTransport({ url: "ws://relay", roomId: "R" });
    const a = factory();
    const b = factory();
    expect(a).not.toBe(b);
    expect(a).toBeInstanceOf(RelayClientTransport);
  });
});
