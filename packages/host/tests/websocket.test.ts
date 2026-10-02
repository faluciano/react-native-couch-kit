import { FakeConfigServer, resetNativeFakes } from "./helpers/native-fakes";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { DEFAULT_WS_PATH } from "@couch-kit/core";

// Loaded after the native mocks are registered.
const { GameWebSocketServer } = await import("../src/websocket");

/** Lets the rejection handlers on fire-and-forget sends run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A started server plus every event it emitted, in order. */
async function startServer(config: { maxMessageBytes?: number } = {}) {
  const server = new GameWebSocketServer({ port: 8082, ...config });
  const events = {
    connection: [] as string[],
    message: [] as [string, unknown][],
    disconnect: [] as string[],
    listening: [] as number[],
    error: [] as Error[],
  };
  server.on("connection", (id) => events.connection.push(id));
  server.on("message", (id, message) => events.message.push([id, message]));
  server.on("disconnect", (id) => events.disconnect.push(id));
  server.on("listening", (port) => events.listening.push(port));
  server.on("error", (error) => events.error.push(error));
  await server.start();
  return { server, events, native: FakeConfigServer.latest() };
}

beforeEach(resetNativeFakes);

describe("GameWebSocketServer start/stop", () => {
  test("binds a WebSocket mount on all interfaces and emits listening", async () => {
    const { events, native } = await startServer();

    expect(native.startArgs?.port).toBe(8082);
    expect(native.startArgs?.host).toBe("0.0.0.0");
    expect(native.startArgs?.config.mounts).toEqual([
      { type: "websocket", path: DEFAULT_WS_PATH },
    ]);
    expect(native.wsHandlers.has(DEFAULT_WS_PATH)).toBe(true);
    expect(events.listening).toEqual([8082]);
    expect(events.error).toHaveLength(0);
  });

  test("answers plain HTTP requests with a 404", async () => {
    const { native } = await startServer();
    const response = await native.startArgs!.handler();
    expect(response.statusCode).toBe(404);
  });

  test("reports a failed start as an error instead of throwing", async () => {
    FakeConfigServer.nextStartError = new Error("EADDRINUSE");
    const { events } = await startServer();

    expect(events.listening).toHaveLength(0);
    expect(events.error.map((e) => e.message)).toEqual(["EADDRINUSE"]);
  });

  test("wraps a non-Error start failure in an Error", async () => {
    FakeConfigServer.nextStartError = "port busy";
    const { events } = await startServer();

    expect(events.error).toHaveLength(1);
    expect(events.error[0]).toBeInstanceOf(Error);
    expect(events.error[0]!.message).toBe("port busy");
  });

  test("stop closes every client, then the native server", async () => {
    const { server, native } = await startServer();
    const a = native.connect();
    const b = native.connect();

    await server.stop();

    expect(a.closeCalls).toEqual([
      { code: 1000, reason: "Server shutting down" },
    ]);
    expect(b.closeCalls).toHaveLength(1);
    expect(native.stopCalls).toBe(1);
    expect(server.clientCount).toBe(0);
  });

  test("a client that fails to close does not block shutdown", async () => {
    const { server, native } = await startServer();
    const stuck = native.connect();
    stuck.closeError = new Error("already gone");
    const ok = native.connect();

    await server.stop();

    expect(ok.closeCalls).toHaveLength(1);
    expect(native.stopCalls).toBe(1);
  });

  test("stop is a no-op before start and after a previous stop", async () => {
    const server = new GameWebSocketServer({ port: 8082 });
    await server.stop();
    expect(FakeConfigServer.instances).toHaveLength(0);

    await server.start();
    const native = FakeConfigServer.latest();
    await server.stop();
    await server.stop();
    expect(native.stopCalls).toBe(1);
  });

  test("debug mode logs through console.log", async () => {
    const log = mock(() => {});
    const original = console.log;
    console.log = log;
    try {
      const server = new GameWebSocketServer({ port: 8082, debug: true });
      await server.start();
      expect(log).toHaveBeenCalled();
    } finally {
      console.log = original;
    }
  });
});

describe("GameWebSocketServer connections", () => {
  test("gives each connection a distinct id and counts it", async () => {
    const { server, events, native } = await startServer();

    native.connect();
    native.connect();

    expect(events.connection).toHaveLength(2);
    expect(events.connection[0]).not.toBe(events.connection[1]);
    expect(server.clientCount).toBe(2);
  });

  test("a disconnect forgets the client and emits its id", async () => {
    const { server, events, native } = await startServer();
    const ws = native.connect();
    const [id] = events.connection;

    ws.disconnect(1001, "going away");

    expect(events.disconnect).toEqual([id!]);
    expect(server.clientCount).toBe(0);

    // A forgotten client is no longer a send target.
    server.send(id!, { type: "PING" });
    expect(ws.sent).toHaveLength(0);
  });

  test("a socket error surfaces as an error event", async () => {
    const { events, native } = await startServer();
    native.connect().fail("connection reset");

    expect(events.error.map((e) => e.message)).toEqual([
      "WebSocket error: connection reset",
    ]);
  });
});

describe("GameWebSocketServer inbound frames", () => {
  test("parses JSON text frames and tags them with the connection id", async () => {
    const { events, native } = await startServer();
    const ws = native.connect();

    ws.receiveJson({ type: "PING", payload: { id: "1", timestamp: 5 } });

    expect(events.message).toEqual([
      [
        events.connection[0]!,
        { type: "PING", payload: { id: "1", timestamp: 5 } },
      ],
    ]);
  });

  test("decodes binary frames as UTF-8 JSON", async () => {
    const { events, native } = await startServer();
    const ws = native.connect();

    const bytes = new TextEncoder().encode(JSON.stringify({ type: "ñ" }));
    ws.receive(bytes.buffer as ArrayBuffer);

    expect(events.message).toHaveLength(1);
    expect(events.message[0]![1]).toEqual({ type: "ñ" });
  });

  test("discards malformed JSON without emitting or erroring", async () => {
    const { events, native } = await startServer();
    const ws = native.connect();

    ws.receive("{not json");
    ws.receive("");

    expect(events.message).toHaveLength(0);
    expect(events.error).toHaveLength(0);
    // The connection survives a bad frame.
    ws.receiveJson({ type: "OK" });
    expect(events.message).toHaveLength(1);
  });

  test("discards frames larger than maxMessageBytes before parsing", async () => {
    const { events, native } = await startServer({ maxMessageBytes: 32 });
    const ws = native.connect();

    const small = JSON.stringify({ type: "A" });
    const large = JSON.stringify({ type: "A", payload: "x".repeat(64) });
    ws.receive(large);
    ws.receive(small);

    expect(events.message.map(([, message]) => message)).toEqual([
      { type: "A" },
    ]);
  });

  test("measures the limit in bytes, not characters", async () => {
    // 10 two-byte characters plus quotes: 12 characters but 22 bytes.
    const frame = JSON.stringify("é".repeat(10));
    const { events, native } = await startServer({ maxMessageBytes: 20 });
    const ws = native.connect();

    ws.receive(frame);
    expect(events.message).toHaveLength(0);

    const binary = new TextEncoder().encode(frame).buffer as ArrayBuffer;
    ws.receive(binary);
    expect(events.message).toHaveLength(0);
  });

  test("a frame exactly at the limit is accepted", async () => {
    const frame = JSON.stringify({ type: "A" });
    const { events, native } = await startServer({
      maxMessageBytes: frame.length,
    });
    native.connect().receive(frame);
    expect(events.message).toHaveLength(1);
  });
});

describe("GameWebSocketServer outbound", () => {
  test("send serializes to the one addressed client", async () => {
    const { server, events, native } = await startServer();
    const a = native.connect();
    const b = native.connect();

    server.send(events.connection[0]!, { type: "PONG", payload: 1 });

    expect(a.messages()).toEqual([{ type: "PONG", payload: 1 }]);
    expect(b.sent).toHaveLength(0);
  });

  test("send to an unknown id is silently ignored", async () => {
    const { server, events } = await startServer();
    server.send("nobody", { type: "X" });
    expect(events.error).toHaveLength(0);
  });

  test("a rejected send surfaces as an error event", async () => {
    const { server, events, native } = await startServer();
    const ws = native.connect();
    ws.sendError = new Error("socket closed");

    server.send(events.connection[0]!, { type: "X" });
    await flush();

    expect(events.error.map((e) => e.message)).toEqual(["socket closed"]);
  });

  test("an unserializable send surfaces as an error event", async () => {
    const { server, events, native } = await startServer();
    const ws = native.connect();

    server.send(events.connection[0]!, { big: 1n });

    expect(ws.sent).toHaveLength(0);
    expect(events.error).toHaveLength(1);
  });

  test("broadcast reaches every client except the excluded one", async () => {
    const { server, events, native } = await startServer();
    const a = native.connect();
    const b = native.connect();
    const c = native.connect();

    server.broadcast({ type: "ALL" });
    server.broadcast({ type: "OTHERS" }, events.connection[1]);

    expect(a.messageTypes()).toEqual(["ALL", "OTHERS"]);
    expect(b.messageTypes()).toEqual(["ALL"]);
    expect(c.messageTypes()).toEqual(["ALL", "OTHERS"]);
  });

  test("one failed broadcast send does not skip the rest", async () => {
    const { server, events, native } = await startServer();
    native.connect().sendError = new Error("broken pipe");
    const healthy = native.connect();

    server.broadcast({ type: "ALL" });
    await flush();

    expect(healthy.messageTypes()).toEqual(["ALL"]);
    // Per-client broadcast failures are logged, not raised.
    expect(events.error).toHaveLength(0);
  });

  test("an unserializable broadcast surfaces as an error event", async () => {
    const { server, events, native } = await startServer();
    const ws = native.connect();

    server.broadcast({ big: 1n });

    expect(ws.sent).toHaveLength(0);
    expect(events.error).toHaveLength(1);
  });

  test("multicast sends only to the given ids", async () => {
    const { server, events, native } = await startServer();
    const a = native.connect();
    const b = native.connect();
    const c = native.connect();
    const [idA, , idC] = events.connection;

    server.multicast(new Set([idA!, idC!]), { type: "STATE_UPDATE" });

    expect(a.messageTypes()).toEqual(["STATE_UPDATE"]);
    expect(b.sent).toHaveLength(0);
    expect(c.messageTypes()).toEqual(["STATE_UPDATE"]);
  });

  test("multicast serializes once and sends the identical frame", async () => {
    const { server, events, native } = await startServer();
    const a = native.connect();
    const b = native.connect();

    const stringify = mock(JSON.stringify);
    const original = JSON.stringify;
    JSON.stringify = stringify as typeof JSON.stringify;
    try {
      server.multicast(events.connection, { type: "STATE_UPDATE" });
    } finally {
      JSON.stringify = original;
    }

    expect(stringify).toHaveBeenCalledTimes(1);
    expect(a.sent[0]).toBe(b.sent[0]!);
  });

  test("multicast skips unknown and disconnected ids", async () => {
    const { server, events, native } = await startServer();
    const a = native.connect();
    const gone = native.connect();
    const goneId = events.connection[1]!;
    gone.disconnect();

    server.multicast(["unknown", goneId, events.connection[0]!], { type: "S" });

    expect(a.messageTypes()).toEqual(["S"]);
    expect(gone.sent).toHaveLength(0);
    expect(events.error).toHaveLength(0);
  });

  test("one failed multicast send does not skip the rest", async () => {
    const { server, events, native } = await startServer();
    native.connect().sendError = new Error("broken pipe");
    const healthy = native.connect();

    server.multicast(events.connection, { type: "S" });
    await flush();

    expect(healthy.messageTypes()).toEqual(["S"]);
    expect(events.error).toHaveLength(0);
  });

  test("an unserializable multicast surfaces as an error event", async () => {
    const { server, events, native } = await startServer();
    const ws = native.connect();

    server.multicast(events.connection, { big: 1n });

    expect(ws.sent).toHaveLength(0);
    expect(events.error).toHaveLength(1);
  });

  test("multicast to no recipients sends nothing", async () => {
    const { server, native } = await startServer();
    const ws = native.connect();
    server.multicast([], { type: "S" });
    expect(ws.sent).toHaveLength(0);
  });
});
