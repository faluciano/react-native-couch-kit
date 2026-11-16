import { registerDom, unregisterDom } from "./helpers/dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { act, cleanup, configure, renderHook } from "@testing-library/react";
import type { HostMessage, IGameState } from "@couch-kit/core";
import { useGameClient, type ClientConfig } from "../src/client";
import { TransportReadyState, type ClientTransport } from "../src/transport";

interface CounterState extends IGameState {
  count: number;
}
type CounterAction = { type: "INC" } | { type: "ILLEGAL" };

const initialState: CounterState = { status: "lobby", players: {}, count: 0 };

/** Optimistically counts ILLEGAL too — the host is what refuses it. */
const reducer = (state: CounterState, action: CounterAction): CounterState =>
  action.type === "INC" || action.type === "ILLEGAL"
    ? { ...state, count: state.count + 1 }
    : state;

/**
 * A transport that behaves like a browser WebSocket where it matters here:
 * `close()` only *starts* the close, and the `close` event arrives later.
 */
class FakeTransport implements ClientTransport {
  readyState: number = TransportReadyState.CONNECTING;
  readonly sent: { type: string; payload: unknown }[] = [];
  closeCalled = false;
  onopen?: () => void;
  onmessage?: (data: string) => void;
  onclose?: (code: number, reason?: string) => void;
  onerror?: (error?: unknown) => void;

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.closeCalled = true;
    this.readyState = TransportReadyState.CLOSING;
    setTimeout(() => this.drop(1006), 5);
  }

  open(): void {
    this.readyState = TransportReadyState.OPEN;
    this.onopen?.();
  }

  receive(message: HostMessage): void {
    this.onmessage?.(JSON.stringify(message));
  }

  /** The connection ends without the client asking for it. */
  drop(code: number, reason?: string): void {
    this.readyState = TransportReadyState.CLOSED;
    this.onclose?.(code, reason);
  }

  sentTypes(): string[] {
    return this.sent.map((message) => message.type);
  }
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function setup(
  overrides: Partial<ClientConfig<CounterState, CounterAction>> = {},
) {
  const transports: FakeTransport[] = [];
  const hook = renderHook(
    (props: Partial<ClientConfig<CounterState, CounterAction>>) =>
      useGameClient<CounterState, CounterAction>({
        initialState,
        baseDelay: 10,
        maxDelay: 10,
        createTransport: () => {
          const transport = new FakeTransport();
          transports.push(transport);
          return transport;
        },
        ...overrides,
        ...props,
      }),
    { initialProps: {} },
  );
  const live = () => transports.filter((t) => !t.closeCalled);
  return { ...hook, transports, live };
}

const welcome = (count: number): HostMessage => ({
  type: "WELCOME",
  payload: {
    playerId: "player-1",
    state: { ...initialState, count },
    serverTime: Date.now(),
  },
});

const stateUpdate = (count: number): HostMessage => ({
  type: "STATE_UPDATE",
  payload: { newState: { ...initialState, count }, timestamp: Date.now() },
});

afterEach(() => {
  cleanup();
  configure({ reactStrictMode: false });
});

beforeAll(registerDom);

afterAll(() => {
  unregisterDom();
});

describe("useGameClient connection lifecycle", () => {
  test("joins on open and hydrates from WELCOME", async () => {
    const { result, transports } = setup({ name: "Alice" });
    expect(result.current.status).toBe("connecting");

    await act(async () => {
      transports[0].open();
      transports[0].receive(welcome(3));
    });

    expect(result.current.status).toBe("connected");
    expect(result.current.playerId).toBe("player-1");
    expect(result.current.state.count).toBe(3);
    const join = transports[0].sent.find((m) => m.type === "JOIN");
    expect((join?.payload as { name: string }).name).toBe("Alice");
  });

  test("starts time sync once the socket opens", async () => {
    const { result, transports } = setup();
    expect(transports[0].sentTypes()).not.toContain("PING");

    await act(async () => {
      transports[0].open();
    });

    const ping = transports[0].sent.find((m) => m.type === "PING");
    expect(ping).toBeDefined();

    const { id, timestamp } = ping?.payload as {
      id: string;
      timestamp: number;
    };
    await act(async () => {
      await wait(15);
      transports[0].receive({
        type: "PONG",
        payload: { id, origTimestamp: timestamp, serverTime: Date.now() },
      });
    });
    expect(result.current.rtt).toBeGreaterThan(0);
  });

  test("StrictMode's double mount leaves exactly one connection", async () => {
    configure({ reactStrictMode: true });
    const { result, transports, live } = setup();

    // Let the discarded first mount's socket deliver its late close event.
    await act(async () => {
      await wait(40);
    });
    expect(live()).toHaveLength(1);

    await act(async () => {
      live()[0].open();
      await wait(40);
    });

    expect(transports).toHaveLength(2);
    expect(live()).toHaveLength(1);
    expect(result.current.status).toBe("connected");
    expect(
      live()[0]
        .sentTypes()
        .filter((t) => t === "JOIN"),
    ).toHaveLength(1);
  });

  test("changing retry options replaces the connection instead of adding one", async () => {
    const { result, rerender, transports, live } = setup();
    await act(async () => {
      transports[0].open();
    });

    await act(async () => {
      rerender({ maxRetries: 9 });
      await wait(40);
    });
    await act(async () => {
      live()[0].open();
      await wait(40);
    });

    expect(transports).toHaveLength(2);
    expect(live()).toHaveLength(1);
    expect(result.current.status).toBe("connected");
  });

  test("reconnect() is not undone by the old socket's late close", async () => {
    const { result, transports, live } = setup();
    await act(async () => {
      transports[0].open();
    });

    await act(async () => {
      result.current.reconnect();
    });
    await act(async () => {
      live()[0].open();
      await wait(40);
    });

    expect(transports).toHaveLength(2);
    expect(live()).toHaveLength(1);
    expect(result.current.status).toBe("connected");
  });

  test("retries a dropped connection with backoff", async () => {
    const onDisconnect: number[] = [];
    const { result, transports } = setup({
      onDisconnect: () => onDisconnect.push(1),
    });
    await act(async () => {
      transports[0].open();
    });

    await act(async () => {
      transports[0].drop(1006);
    });
    expect(result.current.status).toBe("disconnected");
    expect(onDisconnect).toHaveLength(1);

    await act(async () => {
      await wait(40);
    });
    expect(transports).toHaveLength(2);
    expect(result.current.status).toBe("connecting");
  });

  test("a terminal close is not retried and explains itself until the next connect", async () => {
    const { result, transports } = setup();
    await act(async () => {
      transports[0].open();
      transports[0].drop(1008, "ROOM_NOT_FOUND");
      await wait(40);
    });

    expect(transports).toHaveLength(1);
    expect(result.current.status).toBe("disconnected");
    expect(result.current.disconnectReason).toBe("ROOM_NOT_FOUND");

    await act(async () => {
      result.current.reconnect();
    });
    await act(async () => {
      transports[1].open();
    });
    expect(result.current.disconnectReason).toBeNull();
  });

  test("a new connectionKey connects again after a terminal close", async () => {
    const { result, transports, rerender } = setup({ connectionKey: "WRONG" });
    await act(async () => {
      transports[0].open();
      transports[0].drop(1008, "ROOM_NOT_FOUND");
      await wait(40);
    });
    expect(transports).toHaveLength(1);
    expect(result.current.disconnectReason).toBe("ROOM_NOT_FOUND");

    await act(async () => {
      rerender({ connectionKey: "RIGHT" });
    });

    expect(transports).toHaveLength(2);
    expect(result.current.status).toBe("connecting");
    expect(result.current.disconnectReason).toBeNull();
  });

  test("an unchanged connectionKey does not reconnect on re-render", async () => {
    const { transports, rerender } = setup({ connectionKey: "ROOM" });
    await act(async () => {
      transports[0].open();
      rerender({ connectionKey: "ROOM", name: "Renamed" });
    });
    expect(transports).toHaveLength(1);
  });

  test("coming back online reconnects after the retries ran out", async () => {
    const { result, transports } = setup({ maxRetries: 1 });
    await act(async () => {
      transports[0].open();
      transports[0].drop(1006);
      await wait(40);
    });
    await act(async () => {
      transports[1].drop(1006);
      await wait(40);
    });
    expect(transports).toHaveLength(2);
    expect(result.current.status).toBe("disconnected");

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    expect(transports).toHaveLength(3);
    expect(result.current.status).toBe("connecting");
  });

  test("becoming visible skips the pending backoff and connects now", async () => {
    const { transports } = setup({ baseDelay: 10_000, maxDelay: 10_000 });
    await act(async () => {
      transports[0].open();
      transports[0].drop(1006);
    });
    expect(transports).toHaveLength(1);

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(transports).toHaveLength(2);
  });

  test("resuming does not undo a terminal close or disconnect()", async () => {
    const terminal = setup();
    await act(async () => {
      terminal.transports[0].open();
      terminal.transports[0].drop(1008, "ROOM_NOT_FOUND");
      window.dispatchEvent(new Event("online"));
    });
    expect(terminal.transports).toHaveLength(1);
    cleanup();

    const manual = setup();
    await act(async () => {
      manual.transports[0].open();
      manual.result.current.disconnect();
      await wait(40);
      window.dispatchEvent(new Event("online"));
    });
    expect(manual.transports).toHaveLength(1);
  });

  test("reconnectOnResume: false leaves resuming to the app", async () => {
    const { transports } = setup({ maxRetries: 0, reconnectOnResume: false });
    await act(async () => {
      transports[0].open();
      transports[0].drop(1006);
      window.dispatchEvent(new Event("online"));
    });
    expect(transports).toHaveLength(1);
  });

  test("a transport's sessionScope keeps a separate secret per scope", async () => {
    localStorage.clear();
    let scope = "relay:wss://r#AAAA";
    const transports: FakeTransport[] = [];
    const { rerender } = renderHook(
      (props: { key: string }) =>
        useGameClient<CounterState, CounterAction>({
          initialState,
          connectionKey: props.key,
          createTransport: () => {
            const transport = Object.assign(new FakeTransport(), {
              sessionScope: scope,
            });
            transports.push(transport);
            return transport;
          },
        }),
      { initialProps: { key: "AAAA" } },
    );
    await act(async () => {
      transports[0].open();
    });
    scope = "relay:wss://r#BBBB";
    await act(async () => {
      rerender({ key: "BBBB" });
    });
    await act(async () => {
      transports[1].open();
    });

    const secretOf = (t: FakeTransport) =>
      (t.sent.find((m) => m.type === "JOIN")?.payload as { secret: string })
        .secret;
    expect(secretOf(transports[0])).not.toBe(secretOf(transports[1]));
    expect(localStorage.getItem("ck_secret:relay:wss://r#AAAA")).toBe(
      secretOf(transports[0]),
    );
    expect(localStorage.getItem("ck_secret")).toBeNull();
  });

  test("disconnect() closes the socket and stays disconnected", async () => {
    const { result, transports } = setup();
    await act(async () => {
      transports[0].open();
    });

    await act(async () => {
      result.current.disconnect();
      await wait(40);
    });

    expect(transports).toHaveLength(1);
    expect(transports[0].closeCalled).toBe(true);
    expect(result.current.status).toBe("disconnected");
  });

  test("unmounting closes the socket without reconnecting", async () => {
    const { unmount, transports } = setup();
    await act(async () => {
      transports[0].open();
    });

    unmount();
    await wait(40);

    expect(transports).toHaveLength(1);
    expect(transports[0].closeCalled).toBe(true);
  });
});

describe("useGameClient optimistic updates", () => {
  async function connected(
    overrides: Partial<ClientConfig<CounterState, CounterAction>> = {},
  ) {
    const harness = setup({ reducer, optimisticTimeoutMs: 30, ...overrides });
    await act(async () => {
      harness.transports[0].open();
      harness.transports[0].receive(welcome(1));
    });
    return harness;
  }

  test("applies an action locally and sends it to the host", async () => {
    const { result, transports } = await connected();

    await act(async () => {
      result.current.sendAction({ type: "INC" });
    });

    expect(result.current.state.count).toBe(2);
    expect(transports[0].sent.at(-1)).toEqual({
      type: "ACTION",
      payload: { type: "INC" },
    });
  });

  test("sendAction reports false and applies nothing while not connected", async () => {
    const { result, transports } = setup({ reducer });
    let sent = true;
    await act(async () => {
      sent = result.current.sendAction({ type: "INC" });
    });
    expect(sent).toBe(false);
    expect(result.current.state.count).toBe(0);
    expect(transports[0].sent).toHaveLength(0);
  });

  test("sendAction reports true once sent", async () => {
    const { result } = await connected();
    let sent = false;
    await act(async () => {
      sent = result.current.sendAction({ type: "INC" });
    });
    expect(sent).toBe(true);
  });

  test("falls back to the host's state when the host never confirms", async () => {
    const { result } = await connected();

    await act(async () => {
      result.current.sendAction({ type: "ILLEGAL" });
    });
    expect(result.current.state.count).toBe(2);

    // The host ignored the action, so it broadcasts nothing.
    await act(async () => {
      await wait(60);
    });
    expect(result.current.state.count).toBe(1);
  });

  test("a host update confirms the action and cancels the fallback", async () => {
    const { result, transports } = await connected();

    await act(async () => {
      result.current.sendAction({ type: "INC" });
      transports[0].receive(stateUpdate(2));
      await wait(60);
    });

    expect(result.current.state.count).toBe(2);
  });

  test("a host ERROR drops the optimistic update at once and reports it", async () => {
    const errors: string[] = [];
    const { result, transports } = await connected({
      optimisticTimeoutMs: 10_000,
      onError: (error) => errors.push(error.code),
    });

    await act(async () => {
      result.current.sendAction({ type: "INC" });
    });
    expect(result.current.state.count).toBe(2);

    await act(async () => {
      transports[0].receive({
        type: "ERROR",
        payload: { code: "RATE_LIMITED", message: "Too many actions" },
      });
    });

    expect(result.current.state.count).toBe(1);
    expect(errors).toEqual(["RATE_LIMITED"]);
  });

  test("optimisticTimeoutMs: 0 keeps the optimistic state until the host speaks", async () => {
    const { result } = await connected({ optimisticTimeoutMs: 0 });

    await act(async () => {
      result.current.sendAction({ type: "ILLEGAL" });
      await wait(60);
    });

    expect(result.current.state.count).toBe(2);
  });

  test("without a reducer the client renders only what the host sends", async () => {
    const { result, transports } = setup({ optimisticTimeoutMs: 30 });
    await act(async () => {
      transports[0].open();
      transports[0].receive(welcome(5));
    });

    await act(async () => {
      result.current.sendAction({ type: "INC" });
      await wait(60);
    });

    expect(result.current.state.count).toBe(5);
    expect(transports[0].sentTypes()).toContain("ACTION");
  });
});

describe("useGameClient sendActionWithResult", () => {
  async function connected(
    overrides: Partial<ClientConfig<CounterState, CounterAction>> = {},
  ) {
    const harness = setup({ reducer, optimisticTimeoutMs: 0, ...overrides });
    await act(async () => {
      harness.transports[0].open();
      harness.transports[0].receive(welcome(1));
    });
    return harness;
  }

  test("sends the action with an id and resolves on the host's ok", async () => {
    const { result, transports } = await connected();
    let promise!: Promise<unknown>;
    await act(async () => {
      promise = result.current.sendActionWithResult({ type: "INC" });
    });
    const sent = transports[0].sent.at(-1) as unknown as { id: string };
    expect(sent).toMatchObject({ type: "ACTION", payload: { type: "INC" } });
    expect(typeof sent.id).toBe("string");

    await act(async () => {
      transports[0].receive({
        type: "ACTION_RESULT",
        payload: { id: sent.id, ok: true },
      });
    });
    expect(await promise).toEqual({ ok: true });
    expect(result.current.state.count).toBe(2);
  });

  test("a refusal resolves with the reason, rolls back, and reaches onError", async () => {
    const errors: unknown[] = [];
    const { result, transports } = await connected({
      onError: (error) => errors.push(error),
    });
    let promise!: Promise<unknown>;
    await act(async () => {
      promise = result.current.sendActionWithResult({ type: "ILLEGAL" });
    });
    expect(result.current.state.count).toBe(2);
    const { id } = transports[0].sent.at(-1) as unknown as { id: string };

    await act(async () => {
      transports[0].receive({
        type: "ACTION_RESULT",
        payload: {
          id,
          ok: false,
          code: "FORBIDDEN_ACTION",
          message: "Not your turn",
        },
      });
    });

    expect(await promise).toEqual({
      ok: false,
      code: "FORBIDDEN_ACTION",
      message: "Not your turn",
    });
    expect(result.current.state.count).toBe(1);
    expect(errors).toEqual([
      { code: "FORBIDDEN_ACTION", message: "Not your turn" },
    ]);
  });

  test("settles NOT_CONNECTED without sending when offline", async () => {
    const { result, transports } = setup({ reducer });
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.sendActionWithResult({ type: "INC" });
    });
    expect(outcome).toMatchObject({ ok: false, code: "NOT_CONNECTED" });
    expect(transports[0].sent).toHaveLength(0);
  });

  test("settles DISCONNECTED when the connection drops first", async () => {
    const { result, transports } = await connected();
    let promise!: Promise<unknown>;
    await act(async () => {
      promise = result.current.sendActionWithResult({ type: "INC" });
      transports[0].drop(1006);
    });
    expect(await promise).toMatchObject({ ok: false, code: "DISCONNECTED" });
  });

  test("settles NO_RESULT when an older host never answers", async () => {
    const { result } = await connected({ actionResultTimeoutMs: 20 });
    let promise!: Promise<unknown>;
    await act(async () => {
      promise = result.current.sendActionWithResult({ type: "INC" });
      await wait(40);
    });
    expect(await promise).toMatchObject({ ok: false, code: "NO_RESULT" });
  });

  test("plain sendAction carries no id", async () => {
    const { result, transports } = await connected();
    await act(async () => {
      result.current.sendAction({ type: "INC" });
    });
    expect(transports[0].sent.at(-1)).toEqual({
      type: "ACTION",
      payload: { type: "INC" },
    });
  });
});
