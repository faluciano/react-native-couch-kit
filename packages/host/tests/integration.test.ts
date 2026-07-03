import { describe, expect, test } from "bun:test";
import {
  MessageTypes,
  InternalActionTypes,
  createGameReducer,
  generateId,
  isValidSecret,
  type IGameState,
  type IAction,
  type HostMessage,
  type InternalAction,
} from "@couch-kit/core";
import { HostSessionManager } from "../src/session-manager";
import { ActionRateLimiter } from "../src/rate-limiter";
import { authorizeClientAction } from "../src/action-authorization";
import {
  isValidClientMessage,
  frameByteLength,
  DEFAULT_MAX_MESSAGE_BYTES,
} from "../src/message-validation";
import { createStateUpdateMessage } from "../src/broadcast-scheduler";

/**
 * Cross-package protocol integration test.
 *
 * The real WebSocket transport (react-native-nitro-http-server) and React
 * rendering are unavailable in the test runtime, so this test wires the actual
 * production building blocks — the core reducer plus the host's
 * session-manager, action-authorization, rate-limiter, message-validation, and
 * broadcast helpers — through an in-memory transport, faithfully mirroring the
 * message handling in `provider.tsx` and the client hydration in `client.ts`.
 *
 * It exercises the full protocol contract end to end: JOIN → WELCOME →
 * ACTION → STATE_UPDATE → client hydrate, plus reconnect, disconnect,
 * authorization, rate limiting, and the inbound size cap.
 */

// ── A representative game: per-player scores ────────────────────────────────
interface ScoreState extends IGameState {
  scores: Record<string, number>;
}

type ScoreAction =
  | { type: "INCREMENT"; payload: number; playerId?: string }
  | { type: string; payload?: unknown; playerId?: string };

const scoreReducer = (state: ScoreState, action: ScoreAction): ScoreState => {
  if (action.type === "INCREMENT" && action.playerId) {
    const by = typeof action.payload === "number" ? action.payload : 1;
    return {
      ...state,
      scores: {
        ...state.scores,
        [action.playerId]: (state.scores[action.playerId] ?? 0) + by,
      },
    };
  }
  return state;
};

const initialState: ScoreState = {
  status: "playing",
  players: {},
  scores: {},
};

// ── Host: mirrors provider.tsx's message handling using the real modules ────
class HostHarness {
  state: ScoreState = initialState;
  readonly outbox = new Map<string, HostMessage[]>();

  private readonly reducer = createGameReducer<ScoreState, ScoreAction>(
    scoreReducer,
  );
  private readonly sessions = new HostSessionManager();
  private readonly rateLimiter = new ActionRateLimiter();
  private actionQueue: unknown[] = [];

  private send(socketId: string, message: HostMessage) {
    const box = this.outbox.get(socketId) ?? [];
    box.push(message);
    this.outbox.set(socketId, box);
  }

  lastTo(socketId: string): HostMessage | undefined {
    const box = this.outbox.get(socketId);
    return box?.[box.length - 1];
  }

  /** Deliver a raw client frame, exactly as the WebSocket transport would. */
  async receive(socketId: string, frame: string): Promise<void> {
    // Inbound size cap (websocket.ts)
    if (frameByteLength(frame) > DEFAULT_MAX_MESSAGE_BYTES) return;

    let raw: unknown;
    try {
      raw = JSON.parse(frame);
    } catch {
      return;
    }

    if (!isValidClientMessage(raw)) {
      this.send(socketId, {
        type: MessageTypes.ERROR,
        payload: { code: "INVALID_MESSAGE", message: "Malformed message" },
      });
      return;
    }
    const message = raw;

    switch (message.type) {
      case MessageTypes.JOIN: {
        const { secret } = message.payload as { secret?: unknown };
        if (typeof secret !== "string" || !isValidSecret(secret)) {
          this.send(socketId, {
            type: MessageTypes.ERROR,
            payload: {
              code: "INVALID_SECRET",
              message: "Invalid or missing session secret",
            },
          });
          return;
        }

        const { playerId, isReconnect, action } =
          await this.sessions.handleJoin<ScoreState>(
            socketId,
            message.payload as { name: string; avatar?: string; secret: string },
            () => this.state.players,
          );
        // Dispatch first so the joining player is in the WELCOME snapshot.
        this.state = this.reducer(this.state, action as ScoreAction);

        if (isReconnect) {
          this.send(socketId, {
            type: MessageTypes.RECONNECTED,
            payload: { playerId, state: this.state },
          });
        } else {
          this.send(socketId, {
            type: MessageTypes.WELCOME,
            payload: { playerId, state: this.state, serverTime: Date.now() },
          });
        }
        break;
      }

      case MessageTypes.ACTION: {
        const actionPayload = message.payload as ScoreAction;
        const resolvedPlayerId =
          this.sessions.getPlayerIdForSocket(socketId);
        const auth = authorizeClientAction(
          actionPayload.type,
          resolvedPlayerId,
        );
        if (auth.kind === "reject") {
          this.send(socketId, {
            type: MessageTypes.ERROR,
            payload: { code: auth.code, message: auth.message },
          });
          return;
        }
        if (!this.rateLimiter.record(socketId).allowed) {
          this.send(socketId, {
            type: MessageTypes.ERROR,
            payload: { code: "RATE_LIMITED", message: "Too many actions" },
          });
          return;
        }
        // Server injects the authoritative playerId (client value is ignored).
        this.state = this.reducer(this.state, {
          ...actionPayload,
          playerId: auth.playerId,
        });
        this.actionQueue.push(actionPayload);
        this.broadcast();
        break;
      }

      case MessageTypes.PING: {
        const p = message.payload as { id: string; timestamp: number };
        this.send(socketId, {
          type: MessageTypes.PONG,
          payload: {
            id: p.id,
            origTimestamp: p.timestamp,
            serverTime: Date.now(),
          },
        });
        break;
      }
    }
  }

  disconnect(socketId: string): void {
    this.rateLimiter.reset(socketId);
    const result = this.sessions.handleDisconnect<ScoreState>(socketId);
    if (result.kind === "left") {
      this.state = this.reducer(this.state, result.action as ScoreAction);
    }
  }

  /** Broadcast the current state to every socket (STATE_UPDATE). */
  private broadcast(): void {
    const actions = this.actionQueue;
    this.actionQueue = [];
    const msg = createStateUpdateMessage(
      this.state,
      actions,
    ) as HostMessage;
    for (const socketId of this.outbox.keys()) {
      this.send(socketId, msg);
    }
  }
}

/** Client: mirrors client.ts hydration (interpretHostMessage → HYDRATE). */
class ClientHarness {
  state: ScoreState = initialState;
  playerId: string | null = null;
  private readonly reducer = createGameReducer<ScoreState, ScoreAction>(
    scoreReducer,
  );

  apply(message: HostMessage): void {
    switch (message.type) {
      case MessageTypes.WELCOME:
        this.playerId = message.payload.playerId;
        this.hydrate(message.payload.state as ScoreState);
        break;
      case MessageTypes.RECONNECTED:
        this.playerId = message.payload.playerId;
        this.hydrate(message.payload.state as ScoreState);
        break;
      case MessageTypes.STATE_UPDATE:
        this.hydrate(message.payload.newState as ScoreState);
        break;
    }
  }

  private hydrate(state: ScoreState): void {
    this.state = this.reducer(this.state, {
      type: InternalActionTypes.HYDRATE,
      payload: state,
    } as InternalAction<ScoreState> as ScoreAction);
  }
}

const join = (name: string, secret: string) =>
  JSON.stringify({
    type: MessageTypes.JOIN,
    payload: { name, avatar: "🎮", secret },
  });
const action = (a: ScoreAction) =>
  JSON.stringify({ type: MessageTypes.ACTION, payload: a });

describe("host↔client protocol integration", () => {
  test("full lifecycle: two players JOIN, act, and converge", async () => {
    const host = new HostHarness();
    const alice = new ClientHarness();
    const bob = new ClientHarness();
    const aSecret = generateId();
    const bSecret = generateId();

    await host.receive("sock-a", join("Alice", aSecret));
    await host.receive("sock-b", join("Bob", bSecret));

    const aWelcome = host.outbox.get("sock-a")![0];
    const bWelcome = host.outbox.get("sock-b")![0];
    expect(aWelcome.type).toBe(MessageTypes.WELCOME);
    expect(bWelcome.type).toBe(MessageTypes.WELCOME);
    alice.apply(aWelcome);
    bob.apply(bWelcome);

    // Player IDs are deterministic, distinct, and present in the snapshot.
    expect(alice.playerId).toMatch(/^[0-9a-f]{16}$/);
    expect(alice.playerId).not.toBe(bob.playerId);
    expect(host.state.players[alice.playerId!].name).toBe("Alice");
    expect(host.state.players[alice.playerId!].connected).toBe(true);

    // Alice scores; both clients receive and converge on the broadcast.
    await host.receive("sock-a", action({ type: "INCREMENT", payload: 5 }));
    const update = host.lastTo("sock-b")!;
    expect(update.type).toBe(MessageTypes.STATE_UPDATE);
    alice.apply(update);
    bob.apply(host.lastTo("sock-a")!);

    expect(host.state.scores[alice.playerId!]).toBe(5);
    expect(alice.state.scores[alice.playerId!]).toBe(5);
    expect(bob.state.scores[alice.playerId!]).toBe(5); // Bob sees Alice's score
    expect(alice.state).toEqual(host.state); // full convergence
  });

  test("server injects the authoritative playerId; spoofing is ignored", async () => {
    const host = new HostHarness();
    const aSecret = generateId();
    await host.receive("sock-a", join("Alice", aSecret));
    const alicePlayerId = (host.lastTo("sock-a") as Extract<
      HostMessage,
      { type: "WELCOME" }
    >).payload.playerId;

    // Alice tries to attribute her INCREMENT to "victim".
    await host.receive(
      "sock-a",
      action({ type: "INCREMENT", payload: 9, playerId: "victim" }),
    );

    expect(host.state.scores[alicePlayerId]).toBe(9);
    expect(host.state.scores["victim"]).toBeUndefined();
  });

  test("actions before JOIN are rejected with NOT_JOINED", async () => {
    const host = new HostHarness();
    await host.receive("ghost", action({ type: "INCREMENT", payload: 1 }));
    const err = host.lastTo("ghost") as Extract<
      HostMessage,
      { type: "ERROR" }
    >;
    expect(err.type).toBe(MessageTypes.ERROR);
    expect(err.payload.code).toBe("NOT_JOINED");
    expect(host.state.scores).toEqual({});
  });

  test("injected internal action types are rejected with FORBIDDEN_ACTION", async () => {
    const host = new HostHarness();
    const secret = generateId();
    await host.receive("sock-a", join("Alice", secret));
    await host.receive(
      "sock-a",
      action({ type: InternalActionTypes.PLAYER_REMOVED, payload: 0 }),
    );
    const err = host.lastTo("sock-a") as Extract<
      HostMessage,
      { type: "ERROR" }
    >;
    expect(err.payload.code).toBe("FORBIDDEN_ACTION");
  });

  test("malformed and oversized frames are handled safely", async () => {
    const host = new HostHarness();
    const secret = generateId();
    await host.receive("sock-a", join("Alice", secret));
    const before = host.outbox.get("sock-a")!.length;

    // Not JSON — silently dropped.
    await host.receive("sock-a", "}{not json");
    // Oversized frame — dropped before parsing, no state change, no reply.
    const huge = JSON.stringify({
      type: MessageTypes.ACTION,
      payload: { type: "INCREMENT", payload: "x".repeat(300 * 1024) },
    });
    expect(frameByteLength(huge)).toBeGreaterThan(DEFAULT_MAX_MESSAGE_BYTES);
    await host.receive("sock-a", huge);

    expect(host.outbox.get("sock-a")!.length).toBe(before); // no new messages
    expect(host.state.scores).toEqual({});

    // Structurally invalid message shape — replies with INVALID_MESSAGE.
    await host.receive("sock-a", JSON.stringify({ type: "ACTION" }));
    const err = host.lastTo("sock-a") as Extract<
      HostMessage,
      { type: "ERROR" }
    >;
    expect(err.payload.code).toBe("INVALID_MESSAGE");
  });

  test("rate limiting kicks in after the per-window budget", async () => {
    const host = new HostHarness();
    const secret = generateId();
    await host.receive("sock-a", join("Alice", secret));

    // 60 allowed, the 61st is rejected (default budget).
    for (let i = 0; i < 60; i++) {
      await host.receive("sock-a", action({ type: "INCREMENT", payload: 1 }));
    }
    await host.receive("sock-a", action({ type: "INCREMENT", payload: 1 }));

    const err = host.lastTo("sock-a") as Extract<
      HostMessage,
      { type: "ERROR" }
    >;
    expect(err.payload.code).toBe("RATE_LIMITED");
    const pid = Object.keys(host.state.scores)[0];
    expect(host.state.scores[pid]).toBe(60); // only 60 applied
  });

  test("disconnect marks a player offline; reconnect restores the same id and data", async () => {
    const host = new HostHarness();
    const alice = new ClientHarness();
    const secret = generateId();

    await host.receive("sock-a", join("Alice", secret));
    alice.apply(host.lastTo("sock-a")!);
    const firstId = alice.playerId!;

    await host.receive("sock-a", action({ type: "INCREMENT", payload: 7 }));

    // Alice drops.
    host.disconnect("sock-a");
    expect(host.state.players[firstId].connected).toBe(false);
    expect(host.state.scores[firstId]).toBe(7); // score preserved

    // Alice returns on a new socket with the same secret.
    await host.receive("sock-a2", join("Alice", secret));
    const reMsg = host.lastTo("sock-a2")!;
    expect(reMsg.type).toBe(MessageTypes.RECONNECTED);
    alice.apply(reMsg);

    expect(alice.playerId).toBe(firstId); // stable across reconnect
    expect(host.state.players[firstId].connected).toBe(true);
    expect(host.state.scores[firstId]).toBe(7); // data intact
  });

  test("PING is answered with a PONG echoing the id and origin timestamp", async () => {
    const host = new HostHarness();
    await host.receive(
      "sock-a",
      JSON.stringify({
        type: MessageTypes.PING,
        payload: { id: "ping-1", timestamp: 1234 },
      }),
    );
    const pong = host.lastTo("sock-a") as Extract<
      HostMessage,
      { type: "PONG" }
    >;
    expect(pong.type).toBe(MessageTypes.PONG);
    expect(pong.payload.id).toBe("ping-1");
    expect(pong.payload.origTimestamp).toBe(1234);
  });

  test("invalid session secret is rejected", async () => {
    const host = new HostHarness();
    await host.receive(
      "sock-a",
      JSON.stringify({
        type: MessageTypes.JOIN,
        payload: { name: "Alice", secret: "too-short" },
      }),
    );
    const err = host.lastTo("sock-a") as Extract<
      HostMessage,
      { type: "ERROR" }
    >;
    expect(err.payload.code).toBe("INVALID_SECRET");
  });
});
