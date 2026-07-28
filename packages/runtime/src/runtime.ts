import {
  DEFAULT_DISCONNECT_TIMEOUT,
  InternalActionTypes,
  MessageTypes,
  createGameReducer,
  isValidSecret,
  type GameReducer,
  type HostMessage,
  type IAction,
  type IGameState,
  type InternalAction,
} from "@couch-kit/core";
import { authorizeClientAction } from "./action-authorization.js";
import {
  BroadcastScheduler,
  DEFAULT_STATE_THROTTLE_MS,
  createStateUpdateMessage,
} from "./broadcast-scheduler.js";
import { isValidClientMessage } from "./message-validation.js";
import { ActionRateLimiter } from "./rate-limiter.js";
import {
  HostSessionManager,
  type JoinSessionPayload,
} from "./session-manager.js";

/** One connection's share of a {@link GameRuntimeTransport.sendMany} delivery. */
export interface AddressedMessage {
  connectionId: string;
  message: HostMessage;
}

/** Minimal message-delivery surface required by the authoritative runtime. */
export interface GameRuntimeTransport {
  send(connectionId: string, message: HostMessage): void;
  broadcast(message: HostMessage): void;
  /**
   * Delivers a batch of per-connection messages, for transports that can carry
   * them in one frame.
   *
   * Optional: the runtime falls back to a {@link GameRuntimeTransport.send} per
   * entry, which is what a plain LAN WebSocket transport wants anyway. It earns
   * its keep on the relay, where each frame the display sends is separately
   * billed and rate-limited, so a projected state update costs one message
   * rather than one per player.
   */
  sendMany?(entries: readonly AddressedMessage[]): void;
}

/** Configuration shared by every authoritative Couch Kit host transport. */
export interface GameHostRuntimeConfig<
  S extends IGameState,
  A extends IAction,
> {
  initialState: S;
  reducer: GameReducer<S, A>;
  /**
   * Narrows the authoritative state to what one player is allowed to see.
   *
   * Without it, every player receives the whole state and any hiding is left to
   * the client — which makes hidden information a convention rather than a
   * rule. With it, the data a player must not see never reaches their device:
   * the runtime sends each connection its own projection instead of one shared
   * broadcast.
   *
   * Omit for games with no hidden information; state is broadcast as before.
   *
   * The projection is what clients receive, so their state type is the *view*,
   * not `S`. A client cannot run the game reducer over a partial view, so
   * `useGameClient` must be used without a `reducer` (no optimistic updates)
   * when a projection is configured.
   *
   * @param state - Current authoritative state.
   * @param playerId - Player the projection is for.
   */
  project?: (state: S, playerId: string) => unknown;
  debug?: boolean;
  /** Timeout before a disconnected player is permanently removed. */
  disconnectTimeout?: number;
  /** Minimum interval between full-state broadcasts. */
  stateThrottleMs?: number;
  onPlayerJoined?: (playerId: string, name: string) => void;
  onPlayerLeft?: (playerId: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Owns the canonical game state and protocol lifecycle independently of React
 * Native, WebSockets, or any future WebRTC transport.
 */
export class GameHostRuntime<S extends IGameState, A extends IAction> {
  private config: GameHostRuntimeConfig<S, A>;
  private readonly reducer: GameReducer<S, A | InternalAction<S>>;
  private state: S;
  private transport: GameRuntimeTransport | null;
  private readonly listeners = new Set<() => void>();
  private readonly sessionManager: HostSessionManager;
  private readonly rateLimiter = new ActionRateLimiter();
  private readonly broadcastScheduler: BroadcastScheduler;
  private readonly assetsLoaded = new Map<string, boolean>();
  private readonly activeConnections = new Map<string, number>();
  private readonly joinedConnections = new Set<string>();
  private readonly pendingJoins = new Set<string>();
  private actionQueue: unknown[] = [];
  private stateDirty = false;
  private nextConnectionGeneration = 1;

  constructor(
    config: GameHostRuntimeConfig<S, A>,
    transport: GameRuntimeTransport | null = null,
  ) {
    this.config = config;
    this.state = config.initialState;
    this.reducer = createGameReducer(config.reducer);
    this.transport = transport;
    this.sessionManager = new HostSessionManager({
      getDisconnectTimeout: () =>
        this.config.disconnectTimeout ?? DEFAULT_DISCONNECT_TIMEOUT,
    });
    this.broadcastScheduler = new BroadcastScheduler({
      stateThrottleMs: config.stateThrottleMs ?? DEFAULT_STATE_THROTTLE_MS,
    });
  }

  /** Returns the current canonical state snapshot. */
  readonly getState = (): S => this.state;

  /** Subscribes to canonical state changes. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Replaces the active message transport without resetting game state. */
  setTransport(transport: GameRuntimeTransport | null): void {
    this.transport = transport;
    if (transport && this.stateDirty) {
      this.broadcastScheduler.schedule(this.broadcastState);
    }
  }

  /** Updates mutable callbacks and timing options while preserving state. */
  updateConfig(config: GameHostRuntimeConfig<S, A>): void {
    this.config = config;
    this.broadcastScheduler.setStateThrottleMs(
      config.stateThrottleMs ?? DEFAULT_STATE_THROTTLE_MS,
    );
  }

  /** Dispatches a trusted action originating from the host display. */
  readonly dispatch = (action: A): void => {
    this.applyAction(action);
  };

  /** Records a newly opened transport connection for optional debug logging. */
  handleConnection(connectionId: string): void {
    this.activeConnections.set(connectionId, this.nextConnectionGeneration++);
    this.log(`[GameRuntime] Client connected: ${connectionId}`);
  }

  /** Validates and processes one parsed client protocol message. */
  async handleMessage(
    connectionId: string,
    rawMessage: unknown,
  ): Promise<void> {
    const connectionGeneration = this.activeConnections.get(connectionId);
    if (connectionGeneration === undefined) {
      this.log(
        `[GameRuntime] Ignoring message from inactive connection: ${connectionId}`,
      );
      return;
    }

    if (!isValidClientMessage(rawMessage)) {
      this.log(
        `[GameRuntime] Invalid message from ${connectionId}:`,
        rawMessage,
      );
      this.send(connectionId, {
        type: MessageTypes.ERROR,
        payload: {
          code: "INVALID_MESSAGE",
          message: "Malformed message",
        },
      });
      return;
    }

    const message = rawMessage;
    this.log(`[GameRuntime] Msg from ${connectionId}:`, message);

    switch (message.type) {
      case MessageTypes.JOIN: {
        const { secret, ...payload } = message.payload;

        if (!secret || typeof secret !== "string" || !isValidSecret(secret)) {
          this.send(connectionId, {
            type: MessageTypes.ERROR,
            payload: {
              code: "INVALID_SECRET",
              message: "Invalid or missing session secret",
            },
          });
          return;
        }

        if (
          this.joinedConnections.has(connectionId) ||
          this.pendingJoins.has(connectionId)
        ) {
          this.send(connectionId, {
            type: MessageTypes.ERROR,
            payload: {
              code: "ALREADY_JOINED",
              message: "This connection has already joined the game",
            },
          });
          return;
        }

        this.pendingJoins.add(connectionId);
        try {
          const { playerId, isReconnect, action } =
            await this.sessionManager.handleJoin<S>(
              connectionId,
              message.payload as JoinSessionPayload,
              () => this.state.players,
            );

          if (
            this.activeConnections.get(connectionId) !== connectionGeneration
          ) {
            this.sessionManager.abandonConnection(connectionId);
            return;
          }

          this.applyAction(action);
          this.joinedConnections.add(connectionId);
          this.assetsLoaded.set(playerId, false);
          this.invokeLifecycleCallback(
            "onPlayerJoined",
            this.config.onPlayerJoined
              ? () => {
                  this.config.onPlayerJoined?.(playerId, payload.name);
                }
              : undefined,
          );

          if (isReconnect) {
            this.send(connectionId, {
              type: MessageTypes.RECONNECTED,
              payload: {
                playerId,
                state: this.viewFor(playerId),
              },
            });
          } else {
            this.send(connectionId, {
              type: MessageTypes.WELCOME,
              payload: {
                playerId,
                state: this.viewFor(playerId),
                serverTime: Date.now(),
              },
            });
          }
        } catch (error) {
          this.log("[GameRuntime] Failed to derive player ID:", error);
          this.send(connectionId, {
            type: MessageTypes.ERROR,
            payload: {
              code: "JOIN_FAILED",
              message: "Failed to process join request",
            },
          });
        } finally {
          this.pendingJoins.delete(connectionId);
        }
        break;
      }

      case MessageTypes.ACTION: {
        const actionPayload = message.payload as A;
        const playerId = this.sessionManager.getPlayerIdForSocket(connectionId);
        const authorization = authorizeClientAction(
          actionPayload.type,
          playerId,
        );

        if (authorization.kind === "reject") {
          this.log(
            `[GameRuntime] Rejected action from ${connectionId} ` +
              `(${authorization.code}):`,
            actionPayload.type,
          );
          this.send(connectionId, {
            type: MessageTypes.ERROR,
            payload: {
              code: authorization.code,
              message: authorization.message,
            },
          });
          return;
        }

        if (!this.rateLimiter.record(connectionId).allowed) {
          this.log(`[GameRuntime] Rate limited ${connectionId}`);
          this.send(connectionId, {
            type: MessageTypes.ERROR,
            payload: {
              code: "RATE_LIMITED",
              message: "Too many actions, slow down",
            },
          });
          return;
        }

        this.applyAction({
          ...actionPayload,
          playerId: authorization.playerId,
        } as A);
        this.actionQueue.push(actionPayload);
        break;
      }

      case MessageTypes.PING:
        this.send(connectionId, {
          type: MessageTypes.PONG,
          payload: {
            id: message.payload.id,
            origTimestamp: message.payload.timestamp,
            serverTime: Date.now(),
          },
        });
        break;

      case MessageTypes.ASSETS_LOADED: {
        const playerId = this.sessionManager.getPlayerIdForSocket(connectionId);
        if (playerId) {
          this.assetsLoaded.set(playerId, true);
          this.log(`[GameRuntime] Assets loaded for ${playerId}`);
        }
        break;
      }
    }
  }

  /** Processes a transport disconnect and starts session recovery cleanup. */
  handleDisconnect(connectionId: string): void {
    this.log(`[GameRuntime] Client disconnected: ${connectionId}`);
    this.activeConnections.delete(connectionId);
    this.joinedConnections.delete(connectionId);
    this.rateLimiter.reset(connectionId);

    const result = this.sessionManager.handleDisconnect<S>(connectionId);
    if (result.kind === "unknown") return;

    this.assetsLoaded.delete(result.playerId);
    if (result.kind === "stale") return;

    this.applyAction(result.action);
    this.invokeLifecycleCallback(
      "onPlayerLeft",
      this.config.onPlayerLeft
        ? () => {
            this.config.onPlayerLeft?.(result.playerId);
          }
        : undefined,
    );
    this.sessionManager.scheduleRemoval(
      result.playerId,
      result.secret,
      (playerId) => {
        this.applyAction({
          type: InternalActionTypes.PLAYER_REMOVED,
          payload: { playerId },
        } as InternalAction<S>);
      },
    );
  }

  /** Surfaces transport failures through the configured host callback. */
  handleError(error: Error): void {
    this.log("[GameRuntime] Transport error:", error);
    this.notifyError(error);
  }

  /** Cancels runtime timers and releases transport-specific state. */
  stop(): void {
    this.broadcastScheduler.cancel();
    this.sessionManager.clearRemovalTimers();
    this.rateLimiter.clear();
    this.activeConnections.clear();
    this.joinedConnections.clear();
    this.pendingJoins.clear();
    this.transport = null;
  }

  private applyAction(action: A | InternalAction<S>): void {
    const nextState = this.reducer(this.state, action);
    if (Object.is(nextState, this.state)) return;

    this.state = nextState;
    this.stateDirty = true;

    for (const listener of this.listeners) {
      listener();
    }

    this.broadcastScheduler.schedule(this.broadcastState);
  }

  /**
   * What `playerId` is allowed to see. Identity unless a projection is
   * configured, so games without hidden information are unaffected.
   */
  private viewFor(playerId: string): unknown {
    const project = this.config.project;
    return project ? project(this.state, playerId) : this.state;
  }

  private readonly broadcastState = (): void => {
    const transport = this.transport;
    if (!transport) return;

    const actions = this.actionQueue;
    this.actionQueue = [];
    this.stateDirty = false;

    if (!this.config.project) {
      transport.broadcast(createStateUpdateMessage(this.state, actions));
      return;
    }

    // Projected games get one message per connection rather than a broadcast:
    // a shared frame cannot carry different views. Transports that can batch
    // (see GameRuntimeTransport.sendMany) still put them on the wire as a
    // single frame; the rest fall back to N sends, bounded by players-per-room.
    const entries: AddressedMessage[] = [];
    for (const connectionId of this.joinedConnections) {
      const playerId = this.sessionManager.getPlayerIdForSocket(connectionId);
      if (!playerId) continue;
      entries.push({
        connectionId,
        message: createStateUpdateMessage(this.viewFor(playerId), actions),
      });
    }
    if (entries.length === 0) return;

    if (transport.sendMany) {
      transport.sendMany(entries);
      return;
    }
    for (const { connectionId, message } of entries) {
      this.send(connectionId, message);
    }
  };

  private send(connectionId: string, message: HostMessage): void {
    this.transport?.send(connectionId, message);
  }

  private invokeLifecycleCallback(
    name: string,
    callback: (() => void) | undefined,
  ): void {
    if (!callback) return;

    try {
      callback();
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      this.notifyError(
        new Error(`${name} callback failed: ${cause.message}`, { cause }),
      );
    }
  }

  private notifyError(error: Error): void {
    const onError = this.config.onError;
    if (!onError) {
      console.error("[GameRuntime] Unhandled error:", error);
      return;
    }

    try {
      onError(error);
    } catch (callbackError) {
      console.error("[GameRuntime] onError callback failed:", callbackError);
    }
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log(...args);
    }
  }
}
