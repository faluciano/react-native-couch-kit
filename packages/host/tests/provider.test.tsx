import {
  FakeConfigServer,
  FakeStaticServer,
  resetNativeFakes,
  type FakeServerWebSocket,
} from "./helpers/native-fakes";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import React, { StrictMode } from "react";
import {
  act,
  cleanup,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { MessageTypes, type IGameState } from "@couch-kit/core";

// Loaded after the native mocks are registered.
const { GameHostProvider, useGameHost } = await import("../src/provider");
type GameHostConfig<
  S extends IGameState,
  A extends { type: string },
> = import("../src/provider").GameHostConfig<S, A>;

interface CounterState extends IGameState {
  count: number;
}
type CounterAction = { type: "INC"; playerId?: string } | { type: "NOOP" };

const initialState: CounterState = { status: "lobby", players: {}, count: 0 };

const reducer = (state: CounterState, action: CounterAction): CounterState =>
  action.type === "INC" ? { ...state, count: state.count + 1 } : state;

const SECRET = "0123456789abcdef0123456789abcdef";
const OTHER_SECRET = "fedcba9876543210fedcba9876543210";

function baseConfig(
  overrides: Partial<GameHostConfig<CounterState, CounterAction>> = {},
): GameHostConfig<CounterState, CounterAction> {
  return {
    initialState,
    reducer,
    staticDir: "/data/www",
    stateThrottleMs: 0,
    ...overrides,
  };
}

type HostContext = ReturnType<typeof useGameHost<CounterState, CounterAction>>;

/** Renders a provider and captures the latest context value it exposes. */
function renderHost(
  config = baseConfig(),
  { strict = false }: { strict?: boolean } = {},
) {
  const latest: { current: HostContext | null } = { current: null };
  function Probe() {
    latest.current = useGameHost<CounterState, CounterAction>();
    return null;
  }
  const tree = (cfg: GameHostConfig<CounterState, CounterAction>) => {
    const host = (
      <GameHostProvider config={cfg}>
        <Probe />
      </GameHostProvider>
    );
    return strict ? <StrictMode>{host}</StrictMode> : host;
  };
  const view = render(tree(config));
  return {
    ...view,
    host: () => latest.current!,
    rerenderWith: (cfg: GameHostConfig<CounterState, CounterAction>) =>
      view.rerender(tree(cfg)),
  };
}

/** The WebSocket server that is currently listening. */
async function listeningServer(): Promise<FakeConfigServer> {
  await waitFor(() => {
    expect(FakeConfigServer.instances.some((s) => s.startArgs)).toBe(true);
  });
  return FakeConfigServer.instances.findLast((s) => s.startArgs !== null)!;
}

/** Opens a phone connection and joins it, resolving with its WELCOME. */
async function join(server: FakeConfigServer, secret = SECRET, name = "Ana") {
  const ws = server.connect();
  await act(async () => {
    ws.receiveJson({ type: MessageTypes.JOIN, payload: { name, secret } });
  });
  await waitFor(() => expect(ws.messageTypes()).toContain("WELCOME"));
  const welcome = ws.messages().find((m) => m.type === "WELCOME")!;
  return {
    ws,
    playerId: (welcome.payload as { playerId: string }).playerId,
    welcome,
  };
}

/** Lets the static server's asynchronous start publish inside act(). */
const settle = () =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

const stateUpdates = (ws: FakeServerWebSocket) =>
  ws
    .messages()
    .filter((m) => m.type === MessageTypes.STATE_UPDATE)
    .map((m) => (m.payload as { newState: CounterState }).newState);

beforeEach(resetNativeFakes);
afterEach(cleanup);

describe("GameHostProvider", () => {
  test("renders its children", async () => {
    const { getByText } = render(
      <GameHostProvider config={baseConfig()}>
        <span>lobby screen</span>
      </GameHostProvider>,
    );
    expect(getByText("lobby screen")).toBeDefined();
    await settle();
  });

  test("starts the WebSocket server on the HTTP port + 2 by default", async () => {
    renderHost(baseConfig({ port: 9000 }));
    const server = await listeningServer();
    expect(server.startArgs?.port).toBe(9002);
  });

  test("honors an explicit wsPort", async () => {
    renderHost(baseConfig({ wsPort: 7777 }));
    const server = await listeningServer();
    expect(server.startArgs?.port).toBe(7777);
  });

  test("exposes the static server URL once it is up", async () => {
    const { host } = renderHost(baseConfig({ port: 9000 }));
    await waitFor(() =>
      expect(host().serverUrl).toBe("http://192.168.1.20:9000/index.html"),
    );
    expect(host().serverError).toBeNull();
    expect(FakeStaticServer.instances[0]?.startArgs?.rootDir).toBe("/data/www");
  });

  test("exposes a static server failure as serverError", async () => {
    FakeStaticServer.nextStartError = new Error("EADDRINUSE");
    const { host } = renderHost();
    await waitFor(() => expect(host().serverError?.message).toBe("EADDRINUSE"));
    expect(host().serverUrl).toBeNull();
  });

  test("a phone JOIN gets a WELCOME and adds the player to state", async () => {
    const onPlayerJoined = mock(() => {});
    const { host } = renderHost(baseConfig({ onPlayerJoined }));
    const server = await listeningServer();

    const { playerId, welcome } = await join(server);

    expect(playerId).toMatch(/^[0-9a-f]{16}$/);
    const welcomeState = (welcome.payload as { state: CounterState }).state;
    expect(welcomeState.players[playerId]?.name).toBe("Ana");
    await waitFor(() =>
      expect(host().state.players[playerId]?.connected).toBe(true),
    );
    expect(onPlayerJoined).toHaveBeenCalledWith(playerId, "Ana");
  });

  test("state broadcasts reach joined sockets only", async () => {
    const { host } = renderHost();
    const server = await listeningServer();
    const lurker = server.connect();
    const { ws: player } = await join(server);

    act(() => host().dispatch({ type: "INC" }));

    await waitFor(() => expect(stateUpdates(player).at(-1)?.count).toBe(1));
    expect(lurker.sent).toHaveLength(0);
    expect(host().state.count).toBe(1);
  });

  test("player actions are reduced and broadcast to every joined player", async () => {
    const { host } = renderHost();
    const server = await listeningServer();
    const ana = await join(server, SECRET, "Ana");
    const ben = await join(server, OTHER_SECRET, "Ben");

    await act(async () => {
      ana.ws.receiveJson({
        type: MessageTypes.ACTION,
        payload: { type: "INC" },
      });
    });

    await waitFor(() => expect(host().state.count).toBe(1));
    await waitFor(() => expect(stateUpdates(ben.ws).at(-1)?.count).toBe(1));
    expect(stateUpdates(ana.ws).at(-1)?.count).toBe(1);
  });

  test("answers a malformed message with INVALID_MESSAGE", async () => {
    renderHost();
    const server = await listeningServer();
    const ws = server.connect();

    await act(async () => {
      ws.receiveJson({ type: "NOT_A_MESSAGE" });
    });

    await waitFor(() => expect(ws.messageTypes()).toEqual(["ERROR"]));
    expect(ws.messages()[0]!.payload).toMatchObject({
      code: "INVALID_MESSAGE",
    });
  });

  test("answers PING with PONG", async () => {
    renderHost();
    const server = await listeningServer();
    const ws = server.connect();

    await act(async () => {
      ws.receiveJson({
        type: MessageTypes.PING,
        payload: { id: "p1", timestamp: 42 },
      });
    });

    await waitFor(() => expect(ws.messageTypes()).toEqual(["PONG"]));
    expect(ws.messages()[0]!.payload).toMatchObject({
      id: "p1",
      origTimestamp: 42,
    });
  });

  test("applies maxMessageBytes to inbound frames", async () => {
    renderHost(baseConfig({ maxMessageBytes: 16 }));
    const server = await listeningServer();
    const ws = server.connect();

    await act(async () => {
      ws.receiveJson({
        type: MessageTypes.PING,
        payload: { id: "1", timestamp: 1 },
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(ws.sent).toHaveLength(0);
  });

  test("a disconnect marks the player as gone", async () => {
    const onPlayerLeft = mock(() => {});
    const { host } = renderHost(baseConfig({ onPlayerLeft }));
    const server = await listeningServer();
    const { ws, playerId } = await join(server);

    act(() => ws.disconnect());

    await waitFor(() =>
      expect(host().state.players[playerId]?.connected).toBe(false),
    );
    expect(onPlayerLeft).toHaveBeenCalledWith(playerId);
  });

  test("socket errors reach onError", async () => {
    const onError = mock((_error: Error) => {});
    renderHost(baseConfig({ onError }));
    const server = await listeningServer();

    act(() => server.connect().fail("connection reset"));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0].message).toBe(
      "WebSocket error: connection reset",
    );
  });

  test("a WebSocket server that fails to start reaches onError", async () => {
    FakeConfigServer.nextStartError = new Error("EADDRINUSE");
    const onError = mock((_error: Error) => {});
    renderHost(baseConfig({ onError }));

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]![0].message).toBe("EADDRINUSE");
  });

  test("a config update takes effect without restarting the server", async () => {
    const first = mock(() => {});
    const second = mock(() => {});
    const { rerenderWith } = renderHost(baseConfig({ onPlayerJoined: first }));
    const server = await listeningServer();

    rerenderWith(baseConfig({ onPlayerJoined: second }));
    await join(server);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(FakeConfigServer.instances).toHaveLength(1);
  });

  test("unmount stops the WebSocket server and closes its clients", async () => {
    const { unmount } = renderHost();
    const server = await listeningServer();
    const ws = server.connect();

    unmount();

    await waitFor(() => expect(server.stopCalls).toBe(1));
    expect(ws.closeCalls).toHaveLength(1);
    expect(FakeStaticServer.instances[0]?.stopCalls).toBe(1);
  });

  test("events arriving after unmount are ignored", async () => {
    const onError = mock(() => {});
    const { unmount } = renderHost(baseConfig({ onError }));
    const server = await listeningServer();
    const ws = server.connect();

    unmount();
    ws.fail("late");
    ws.receiveJson({
      type: MessageTypes.PING,
      payload: { id: "1", timestamp: 1 },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(onError).not.toHaveBeenCalled();
    expect(ws.sent).toHaveLength(0);
  });

  test("a failed shutdown is logged in debug mode, not thrown", async () => {
    const error = mock((..._args: unknown[]) => {});
    const log = mock((..._args: unknown[]) => {});
    const originalError = console.error;
    const originalLog = console.log;
    console.error = error;
    console.log = log;
    try {
      const { unmount } = renderHost(baseConfig({ debug: true }));
      const server = await listeningServer();
      server.stopError = new Error("native stop failed");

      unmount();

      await waitFor(() => expect(error).toHaveBeenCalled());
      expect(String(error.mock.calls[0]![0])).toContain(
        "Failed to stop WebSocket server",
      );
      // The listening event was logged too.
      expect(
        log.mock.calls.some((args) =>
          String(args[0]).includes("[GameHost] WebSocket listening"),
        ),
      ).toBe(true);
    } finally {
      console.error = originalError;
      console.log = originalLog;
    }
  });

  test("under StrictMode the discarded first mount never starts a server", async () => {
    const { host } = renderHost(baseConfig(), { strict: true });
    const server = await listeningServer();

    // StrictMode tears the first effect down before its start is reached, so
    // only the remount binds the port.
    expect(FakeConfigServer.instances).toEqual([server]);
    // The discarded mount's static server is stopped (at cleanup, and again
    // once its start completes).
    await waitFor(() => expect(host().serverUrl).not.toBeNull());
    const [discarded, kept] = FakeStaticServer.instances;
    expect(discarded?.stopCalls).toBeGreaterThanOrEqual(1);
    expect(kept?.stopCalls).toBe(0);

    // The surviving server is fully wired to the runtime.
    const { playerId } = await join(server);
    await waitFor(() =>
      expect(host().state.players[playerId]?.connected).toBe(true),
    );
  });
});

describe("useGameHost", () => {
  test("throws outside a GameHostProvider", () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      expect(() => renderHook(() => useGameHost())).toThrow(
        "useGameHost must be used within a GameHostProvider",
      );
    } finally {
      console.error = originalError;
    }
  });

  test("getState reads canonical state without waiting for a render", async () => {
    const { host } = renderHost();
    const { getState, dispatch } = host();

    act(() => {
      dispatch({ type: "INC" });
      expect(getState().count).toBe(1);
    });
    expect(host().state.count).toBe(1);
    await settle();
  });

  test("subscribeActions sees host dispatches and player lifecycle actions", async () => {
    const { host } = renderHost();
    const server = await listeningServer();
    const seen: string[] = [];
    const unsubscribe = host().subscribeActions((action) => {
      seen.push(action.type);
    });

    act(() => host().dispatch({ type: "NOOP" }));
    await join(server);
    unsubscribe();
    act(() => host().dispatch({ type: "INC" }));

    // No-ops are recorded too; nothing after unsubscribing.
    expect(seen).toEqual(["NOOP", "__PLAYER_JOINED__"]);
  });

  test("dispatch keeps a stable identity across renders", async () => {
    const { host } = renderHost();
    const before = host().dispatch;
    act(() => host().dispatch({ type: "INC" }));
    expect(host().dispatch).toBe(before);
    await settle();
  });
});
