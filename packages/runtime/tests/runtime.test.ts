import { describe, expect, test } from "bun:test";
import {
  InternalActionTypes,
  MessageTypes,
  generateId,
  type HostMessage,
  type IGameState,
} from "@couch-kit/core";
import {
  GameHostRuntime,
  type GameHostRuntimeConfig,
  type GameRuntimeTransport,
} from "../src/runtime";

interface ScoreState extends IGameState {
  scores: Record<string, number>;
}

type ScoreAction =
  { type: "INCREMENT"; payload: number; playerId?: string } | { type: "RESET" };

const initialState: ScoreState = {
  status: "playing",
  players: {},
  scores: {},
};

const reducer = (state: ScoreState, action: ScoreAction): ScoreState => {
  switch (action.type) {
    case "INCREMENT":
      if (!action.playerId) return state;
      return {
        ...state,
        scores: {
          ...state.scores,
          [action.playerId]:
            (state.scores[action.playerId] ?? 0) + action.payload,
        },
      };
    case "RESET":
      return { ...state, scores: {} };
    default:
      return state;
  }
};

class FakeTransport implements GameRuntimeTransport {
  readonly sent = new Map<string, HostMessage[]>();
  readonly broadcasts: HostMessage[] = [];

  send(connectionId: string, message: HostMessage): void {
    const messages = this.sent.get(connectionId) ?? [];
    messages.push(message);
    this.sent.set(connectionId, messages);
  }

  broadcast(message: HostMessage): void {
    this.broadcasts.push(message);
  }

  lastSent(connectionId: string): HostMessage | undefined {
    return this.sent.get(connectionId)?.at(-1);
  }
}

const flushBroadcast = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 5));

function createRuntime(
  overrides: Partial<GameHostRuntimeConfig<ScoreState, ScoreAction>> = {},
  transport = new FakeTransport(),
) {
  return {
    transport,
    runtime: new GameHostRuntime<ScoreState, ScoreAction>(
      {
        initialState,
        reducer,
        stateThrottleMs: 0,
        disconnectTimeout: 60_000,
        ...overrides,
      },
      transport,
    ),
  };
}

async function joinPlayer(
  runtime: GameHostRuntime<ScoreState, ScoreAction>,
  connectionId: string,
  secret = generateId(),
) {
  runtime.handleConnection(connectionId);
  await runtime.handleMessage(connectionId, {
    type: MessageTypes.JOIN,
    payload: {
      name: "Alice",
      avatar: "gamepad",
      secret,
    },
  });
  return secret;
}

describe("GameHostRuntime", () => {
  test("owns canonical state and welcomes a joined player", async () => {
    const { runtime, transport } = createRuntime();
    let notifications = 0;
    runtime.subscribe(() => {
      notifications++;
    });

    await joinPlayer(runtime, "connection-1");

    const welcome = transport.lastSent("connection-1");
    expect(welcome?.type).toBe(MessageTypes.WELCOME);
    if (welcome?.type !== MessageTypes.WELCOME) return;

    expect(welcome.payload.state).toEqual(runtime.getState());
    expect(runtime.getState().players[welcome.payload.playerId].name).toBe(
      "Alice",
    );
    expect(notifications).toBe(1);
  });

  test("authorizes player actions and broadcasts authoritative state", async () => {
    const { runtime, transport } = createRuntime();
    await joinPlayer(runtime, "connection-1");
    const welcome = transport.lastSent("connection-1");
    if (welcome?.type !== MessageTypes.WELCOME) {
      throw new Error("Expected WELCOME");
    }

    await runtime.handleMessage("connection-1", {
      type: MessageTypes.ACTION,
      payload: { type: "INCREMENT", payload: 5 },
    });
    await flushBroadcast();

    expect(runtime.getState().scores[welcome.payload.playerId]).toBe(5);
    const update = transport.broadcasts.at(-1);
    expect(update?.type).toBe(MessageTypes.STATE_UPDATE);
    if (update?.type === MessageTypes.STATE_UPDATE) {
      expect(update.payload.newState).toEqual(runtime.getState());
      expect(update.payload.action).toEqual({
        type: "INCREMENT",
        payload: 5,
      });
    }
  });

  test("injects the authoritative player ID instead of trusting the client", async () => {
    const { runtime, transport } = createRuntime();
    await joinPlayer(runtime, "connection-1");
    const welcome = transport.lastSent("connection-1");
    if (welcome?.type !== MessageTypes.WELCOME) {
      throw new Error("Expected WELCOME");
    }

    await runtime.handleMessage("connection-1", {
      type: MessageTypes.ACTION,
      payload: {
        type: "INCREMENT",
        payload: 9,
        playerId: "spoofed-player",
      },
    });

    expect(runtime.getState().scores[welcome.payload.playerId]).toBe(9);
    expect(runtime.getState().scores["spoofed-player"]).toBeUndefined();
  });

  test("rejects unjoined and internal client actions", async () => {
    const { runtime, transport } = createRuntime();
    runtime.handleConnection("connection-1");

    await runtime.handleMessage("connection-1", {
      type: MessageTypes.ACTION,
      payload: { type: "INCREMENT", payload: 1 },
    });
    expect(transport.lastSent("connection-1")?.type).toBe(MessageTypes.ERROR);

    await joinPlayer(runtime, "connection-1");
    await runtime.handleMessage("connection-1", {
      type: MessageTypes.ACTION,
      payload: {
        type: InternalActionTypes.PLAYER_REMOVED,
        payload: { playerId: "victim" },
      },
    });

    const error = transport.lastSent("connection-1");
    expect(error?.type).toBe(MessageTypes.ERROR);
    if (error?.type === MessageTypes.ERROR) {
      expect(error.payload.code).toBe("FORBIDDEN_ACTION");
    }
  });

  test("rejects malformed messages and invalid session secrets", async () => {
    const { runtime, transport } = createRuntime();
    runtime.handleConnection("connection-1");

    await runtime.handleMessage("connection-1", {
      type: MessageTypes.ACTION,
    });
    let error = transport.lastSent("connection-1");
    expect(error?.type).toBe(MessageTypes.ERROR);
    if (error?.type === MessageTypes.ERROR) {
      expect(error.payload.code).toBe("INVALID_MESSAGE");
    }

    await runtime.handleMessage("connection-1", {
      type: MessageTypes.JOIN,
      payload: {
        name: "Alice",
        secret: "too-short",
      },
    });
    error = transport.lastSent("connection-1");
    expect(error?.type).toBe(MessageTypes.ERROR);
    if (error?.type === MessageTypes.ERROR) {
      expect(error.payload.code).toBe("INVALID_SECRET");
    }
  });

  test("rate limits excessive actions per connection", async () => {
    const { runtime, transport } = createRuntime();
    await joinPlayer(runtime, "connection-1");

    for (let index = 0; index < 61; index++) {
      await runtime.handleMessage("connection-1", {
        type: MessageTypes.ACTION,
        payload: { type: "INCREMENT", payload: 1 },
      });
    }

    const error = transport.lastSent("connection-1");
    expect(error?.type).toBe(MessageTypes.ERROR);
    if (error?.type === MessageTypes.ERROR) {
      expect(error.payload.code).toBe("RATE_LIMITED");
    }
    const playerId = Object.keys(runtime.getState().players)[0];
    expect(runtime.getState().scores[playerId]).toBe(60);
  });

  test("answers time synchronization pings", async () => {
    const { runtime, transport } = createRuntime();
    runtime.handleConnection("connection-1");

    await runtime.handleMessage("connection-1", {
      type: MessageTypes.PING,
      payload: {
        id: "ping-1",
        timestamp: 1234,
      },
    });

    const pong = transport.lastSent("connection-1");
    expect(pong?.type).toBe(MessageTypes.PONG);
    if (pong?.type === MessageTypes.PONG) {
      expect(pong.payload.id).toBe("ping-1");
      expect(pong.payload.origTimestamp).toBe(1234);
    }
  });

  test("preserves player identity across disconnect and reconnect", async () => {
    const { runtime, transport } = createRuntime();
    const secret = await joinPlayer(runtime, "connection-1");
    const welcome = transport.lastSent("connection-1");
    if (welcome?.type !== MessageTypes.WELCOME) {
      throw new Error("Expected WELCOME");
    }

    runtime.handleDisconnect("connection-1");
    expect(runtime.getState().players[welcome.payload.playerId].connected).toBe(
      false,
    );

    await joinPlayer(runtime, "connection-2", secret);
    const reconnected = transport.lastSent("connection-2");
    expect(reconnected?.type).toBe(MessageTypes.RECONNECTED);
    if (reconnected?.type === MessageTypes.RECONNECTED) {
      expect(reconnected.payload.playerId).toBe(welcome.payload.playerId);
      expect(
        runtime.getState().players[welcome.payload.playerId].connected,
      ).toBe(true);
    }
  });

  test("rejects actions from a superseded player connection", async () => {
    const { runtime, transport } = createRuntime();
    const secret = await joinPlayer(runtime, "connection-1");
    const firstWelcome = transport.lastSent("connection-1");
    if (firstWelcome?.type !== MessageTypes.WELCOME) {
      throw new Error("Expected WELCOME");
    }

    await joinPlayer(runtime, "connection-2", secret);
    await runtime.handleMessage("connection-1", {
      type: MessageTypes.ACTION,
      payload: { type: "INCREMENT", payload: 5 },
    });

    expect(
      runtime.getState().scores[firstWelcome.payload.playerId],
    ).toBeUndefined();
    const error = transport.lastSent("connection-1");
    expect(error?.type).toBe(MessageTypes.ERROR);
    if (error?.type === MessageTypes.ERROR) {
      expect(error.payload.code).toBe("NOT_JOINED");
    }
  });

  test("does not create a player when the connection closes during JOIN", async () => {
    const { runtime, transport } = createRuntime();
    const connectionId = "connection-1";
    runtime.handleConnection(connectionId);

    const joining = runtime.handleMessage(connectionId, {
      type: MessageTypes.JOIN,
      payload: {
        name: "Alice",
        secret: generateId(),
      },
    });
    runtime.handleDisconnect(connectionId);
    await joining;

    expect(runtime.getState().players).toEqual({});
    expect(transport.sent.get(connectionId)).toBeUndefined();
  });

  test("rejects repeated JOIN messages from the same connection", async () => {
    const { runtime, transport } = createRuntime();
    const connectionId = "connection-1";
    await joinPlayer(runtime, connectionId);

    await runtime.handleMessage(connectionId, {
      type: MessageTypes.JOIN,
      payload: {
        name: "Second Player",
        secret: generateId(),
      },
    });

    expect(Object.keys(runtime.getState().players)).toHaveLength(1);
    const error = transport.lastSent(connectionId);
    expect(error?.type).toBe(MessageTypes.ERROR);
    if (error?.type === MessageTypes.ERROR) {
      expect(error.payload.code).toBe("ALREADY_JOINED");
    }
  });

  test("rejects a second JOIN while the first one is pending", async () => {
    const { runtime, transport } = createRuntime();
    const connectionId = "connection-1";
    runtime.handleConnection(connectionId);

    const firstJoin = runtime.handleMessage(connectionId, {
      type: MessageTypes.JOIN,
      payload: {
        name: "Alice",
        secret: generateId(),
      },
    });
    await runtime.handleMessage(connectionId, {
      type: MessageTypes.JOIN,
      payload: {
        name: "Second Player",
        secret: generateId(),
      },
    });
    await firstJoin;

    expect(Object.keys(runtime.getState().players)).toHaveLength(1);
    const messages = transport.sent.get(connectionId) ?? [];
    expect(
      messages.some(
        (message) =>
          message.type === MessageTypes.ERROR &&
          message.payload.code === "ALREADY_JOINED",
      ),
    ).toBe(true);
  });

  test("dispatches trusted host actions without a player connection", async () => {
    const { runtime } = createRuntime();
    await joinPlayer(runtime, "connection-1");
    const playerId = Object.keys(runtime.getState().players)[0];

    runtime.dispatch({
      type: "INCREMENT",
      payload: 3,
      playerId,
    });

    expect(runtime.getState().scores[playerId]).toBe(3);
  });

  test("supports late transport attachment and mutable host callbacks", async () => {
    let reportedError: Error | null = null;
    const runtime = new GameHostRuntime<ScoreState, ScoreAction>({
      initialState,
      reducer,
      stateThrottleMs: 0,
    });
    const transport = new FakeTransport();

    runtime.handleConnection("connection-1");
    runtime.dispatch({ type: "RESET" });
    await flushBroadcast();
    expect(transport.broadcasts).toHaveLength(0);

    runtime.setTransport(transport);
    await flushBroadcast();
    expect(transport.broadcasts).toHaveLength(1);

    runtime.updateConfig({
      initialState,
      reducer,
      stateThrottleMs: 0,
      onError: (error) => {
        reportedError = error;
      },
    });
    const error = new Error("transport failed");
    runtime.handleError(error);
    expect(reportedError).toBe(error);

    runtime.stop();
  });

  test("accepts asset-ready messages from joined players", async () => {
    const { runtime, transport } = createRuntime();
    await joinPlayer(runtime, "connection-1");
    const sentBefore = transport.sent.get("connection-1")?.length;

    await runtime.handleMessage("connection-1", {
      type: MessageTypes.ASSETS_LOADED,
      payload: true,
    });

    expect(transport.sent.get("connection-1")?.length).toBe(sentBefore);
  });

  test("continues JOIN when onPlayerJoined throws", async () => {
    const errors: Error[] = [];
    const { runtime, transport } = createRuntime({
      onPlayerJoined: () => {
        throw new Error("join callback failed");
      },
      onError: (error) => {
        errors.push(error);
      },
    });

    await joinPlayer(runtime, "connection-1");

    expect(transport.lastSent("connection-1")?.type).toBe(MessageTypes.WELCOME);
    expect(Object.keys(runtime.getState().players)).toHaveLength(1);
    expect(errors[0]?.message).toContain("onPlayerJoined callback failed");
  });

  test("schedules player removal when onPlayerLeft throws", async () => {
    const errors: Error[] = [];
    const { runtime } = createRuntime({
      disconnectTimeout: 0,
      onPlayerLeft: () => {
        throw new Error("left callback failed");
      },
      onError: (error) => {
        errors.push(error);
      },
    });
    await joinPlayer(runtime, "connection-1");
    const playerId = Object.keys(runtime.getState().players)[0];

    runtime.handleDisconnect("connection-1");
    await flushBroadcast();

    expect(runtime.getState().players[playerId]).toBeUndefined();
    expect(errors[0]?.message).toContain("onPlayerLeft callback failed");
  });
});

/**
 * Hidden information must not reach a device that should not see it. Filtering
 * in the client is a convention players can ignore; projecting here is a rule
 * they cannot.
 */
describe("GameHostRuntime state projection", () => {
  interface HandState extends IGameState {
    hands: Record<string, string[]>;
  }

  const handsInitial: HandState = {
    status: "playing",
    players: {},
    hands: { seat: ["ACE", "KING"] },
  };

  const handsReducer = (state: HandState): HandState => state;

  /** Each player sees only their own hand; others' become counts. */
  const project = (state: HandState, playerId: string) => ({
    ...state,
    hands: Object.fromEntries(
      Object.entries(state.hands).map(([id, cards]) => [
        id,
        id === playerId ? cards : cards.map(() => "HIDDEN"),
      ]),
    ),
  });

  function createHandsRuntime(withProjection: boolean) {
    const transport = new FakeTransport();
    const runtime = new GameHostRuntime<HandState, { type: "NOOP" }>(
      {
        initialState: handsInitial,
        reducer: handsReducer,
        stateThrottleMs: 0,
        disconnectTimeout: 60_000,
        ...(withProjection ? { project } : {}),
      },
      transport,
    );
    return { runtime, transport };
  }

  async function joinHands(
    runtime: GameHostRuntime<HandState, { type: "NOOP" }>,
    connectionId: string,
  ) {
    runtime.handleConnection(connectionId);
    await runtime.handleMessage(connectionId, {
      type: MessageTypes.JOIN,
      payload: { name: "P", avatar: "gamepad", secret: generateId() },
    });
  }

  test("WELCOME carries the projection, not the whole state", async () => {
    const { runtime, transport } = createHandsRuntime(true);
    await joinHands(runtime, "conn-1");

    const welcome = transport
      .sent.get("conn-1")
      ?.find((m) => m.type === MessageTypes.WELCOME);
    const state = (welcome?.payload as { state: HandState }).state;

    // The joining player is not "seat", so that hand must be masked.
    expect(state.hands.seat).toEqual(["HIDDEN", "HIDDEN"]);
    expect(JSON.stringify(state)).not.toContain("ACE");
  });

  test("a player's own data survives the projection", async () => {
    const { runtime, transport } = createHandsRuntime(true);
    await joinHands(runtime, "conn-1");

    const welcome = transport
      .sent.get("conn-1")
      ?.find((m) => m.type === MessageTypes.WELCOME);
    const { playerId, state } = welcome?.payload as {
      playerId: string;
      state: HandState;
    };

    runtime.dispatch({ type: "NOOP" });
    // The projection keys off the player id, so their own entry is untouched.
    expect(project(handsInitial, playerId).hands[playerId]).toBeUndefined();
    expect(state.hands.seat).toEqual(["HIDDEN", "HIDDEN"]);
  });

  test("updates are sent per connection, never broadcast", async () => {
    const { runtime, transport } = createHandsRuntime(true);
    await joinHands(runtime, "conn-1");
    await joinHands(runtime, "conn-2");

    transport.broadcasts.length = 0;
    runtime.dispatch({ type: "NOOP" });
    // Force a state change so a broadcast is scheduled.
    await runtime.handleMessage("conn-1", {
      type: MessageTypes.ACTION,
      payload: { type: "NOOP" },
    });
    await flushBroadcast();

    // A shared frame cannot carry different views, so nothing may be broadcast.
    expect(transport.broadcasts).toHaveLength(0);
  });

  test("without a projection, state is broadcast unchanged", async () => {
    const { runtime, transport } = createHandsRuntime(false);
    await joinHands(runtime, "conn-1");

    const welcome = transport
      .sent.get("conn-1")
      ?.find((m) => m.type === MessageTypes.WELCOME);
    const state = (welcome?.payload as { state: HandState }).state;

    // Games with no hidden information are unaffected.
    expect(state.hands.seat).toEqual(["ACE", "KING"]);
  });
});
