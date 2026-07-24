import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  createWebSocketTransport,
  TransportReadyState,
} from "../src/transport";

/** Minimal controllable WebSocket stand-in. */
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
    this.readyState = TransportReadyState.CLOSING;
  }
  // test drivers
  fireOpen() {
    this.readyState = TransportReadyState.OPEN;
    this.onopen?.();
  }
  fireMessage(data: string) {
    this.onmessage?.({ data });
  }
  fireClose(code: number, reason?: string) {
    this.readyState = TransportReadyState.CLOSED;
    this.onclose?.({ code, reason });
  }
  fireError(e?: unknown) {
    this.onerror?.(e);
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

describe("createWebSocketTransport", () => {
  test("connects to the given url", () => {
    createWebSocketTransport("ws://host:8082/ws");
    expect(MockWebSocket.last().url).toBe("ws://host:8082/ws");
  });

  test("adapts open/message/close/error to normalized callbacks", () => {
    const t = createWebSocketTransport("ws://x");
    const ws = MockWebSocket.last();

    let opened = false;
    let message: string | null = null;
    let closed: { code: number; reason?: string } | null = null;
    let errored = false;
    t.onopen = () => (opened = true);
    t.onmessage = (data) => (message = data);
    t.onclose = (code, reason) => (closed = { code, reason });
    t.onerror = () => (errored = true);

    ws.fireOpen();
    ws.fireMessage("hello");
    ws.fireError();
    ws.fireClose(1000, "bye");

    expect(opened).toBe(true);
    expect(message).toBe("hello");
    expect(errored).toBe(true);
    expect(closed).toEqual({ code: 1000, reason: "bye" });
  });

  test("send/close/readyState delegate to the socket", () => {
    const t = createWebSocketTransport("ws://x");
    const ws = MockWebSocket.last();

    expect(t.readyState).toBe(TransportReadyState.CONNECTING);
    ws.fireOpen();
    expect(t.readyState).toBe(TransportReadyState.OPEN);

    t.send("payload");
    expect(ws.sent).toEqual(["payload"]);

    t.close(1000, "done");
    expect(ws.closed).toEqual({ code: 1000, reason: "done" });
  });
});
