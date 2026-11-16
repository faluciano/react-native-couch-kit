import { useState, useEffect, useRef, useCallback, useReducer } from "react";
import {
  MessageTypes,
  InternalActionTypes,
  DEFAULT_MAX_RETRIES,
  DEFAULT_BASE_DELAY,
  DEFAULT_MAX_DELAY,
  createGameReducer,
  type ActionResult,
  type HostMessage,
  type IGameState,
  type IAction,
  type InternalAction,
} from "@couch-kit/core";
import { useServerTime } from "./time-sync";
import {
  resolveWebSocketUrl,
  computeBackoffDelay,
  shouldReconnect,
  isRecoverableClose,
  resolveSessionSecret,
  interpretHostMessage,
  DEFAULT_OPTIMISTIC_TIMEOUT,
  type HostError,
} from "./connection";
import {
  TransportReadyState,
  createWebSocketTransport,
  type ClientTransport,
  type CreateClientTransport,
} from "./transport";

/** Connection status reported by {@link useGameClient}. */
export type ClientStatus =
  "connecting" | "connected" | "disconnected" | "error";

export interface ClientConfig<S extends IGameState, A extends IAction> {
  url?: string; // Full WebSocket URL (overrides auto-detection)
  wsPort?: number; // WebSocket port (default: auto-detected as HTTP port + 2)
  /**
   * Applies actions locally for an optimistic update before the host confirms.
   *
   * **Omit it when the host projects state per player** (`project` in
   * `GameHostRuntimeConfig`): the client then holds a *view* rather than the
   * whole state, and the game reducer cannot run over a partial view. Without a
   * reducer the client simply renders what the host sends — a round trip that
   * is imperceptible for turn-based games, and the price of hidden information
   * never reaching the device.
   */
  reducer?: (state: S, action: A) => S;
  initialState: S;
  name?: string; // Player display name (default: "Player")
  avatar?: string; // Player avatar emoji (default: "\u{1F600}")
  /** Maximum reconnection attempts before giving up (default: 5). */
  maxRetries?: number;
  /** Base delay (ms) for exponential backoff reconnection (default: 1000). */
  baseDelay?: number;
  /** Maximum delay (ms) cap for reconnection backoff (default: 10000). */
  maxDelay?: number;
  /**
   * How long (ms) an optimistic update may stand without the host confirming
   * it (default: 2000). The host only broadcasts when its state changes, so an
   * action it ignores — an illegal move, a rate-limited tap, one sent while
   * offline — produces no update, and without this the client would keep
   * showing a state the host never had. When the window passes with no update
   * the client falls back to the last state the host sent. Set to `0` to
   * disable. Has no effect without a `reducer`.
   */
  optimisticTimeoutMs?: number;
  /**
   * Keep the clock in sync with the host by exchanging PING/PONG (default:
   * `true`). Powers `getServerTime()` and `rtt`. A game that uses neither can
   * turn it off: on a relay transport every ping, and the host's answer, is a
   * billed message.
   */
  timeSync?: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
  /**
   * Called when the host rejects something this client sent (`RATE_LIMITED`,
   * `NOT_JOINED`, `FORBIDDEN_ACTION`, `INVALID_SECRET`, …).
   */
  onError?: (error: HostError) => void;
  debug?: boolean;
  /**
   * Provide a custom transport factory (e.g. a cross-network relay). When
   * omitted, the client connects over the default LAN WebSocket derived from
   * `url`/`wsPort`. Called on every (re)connect, so it must return a fresh,
   * already-connecting transport each time.
   */
  createTransport?: CreateClientTransport;
  /**
   * Identifies what `createTransport` connects to. Changing it closes the
   * current connection and opens a fresh one, with the retry budget reset.
   *
   * `createTransport` itself is read on each connect but is usually a new
   * function every render, so it cannot signal a change. With a relay, pass
   * the room code: a phone that typed a wrong code (`ROOM_NOT_FOUND`, which is
   * final) then connects as soon as the player enters the right one. To retry
   * the *same* code, call `reconnect()`.
   */
  connectionKey?: string | number | null;
  /**
   * Reconnect at once when the page becomes visible again, is restored from
   * the back/forward cache, or the browser comes back online (default:
   * `true`). A phone that slept through the reconnect attempts would otherwise
   * stay disconnected until the page was reloaded. Final closes (a room that
   * does not exist, a rejected secret) and `disconnect()` are not undone.
   */
  reconnectOnResume?: boolean;
  /**
   * Scope for the session secret when the transport does not set its own (see
   * `ClientTransport.sessionScope`). Players keep one identity per scope.
   */
  sessionScope?: string;
  /**
   * How long (ms) `sendActionWithResult` waits for the host's answer before
   * settling with `NO_RESULT` (default: 5000). Hosts older than this version
   * never answer.
   */
  actionResultTimeoutMs?: number;
}

/** Default for {@link ClientConfig.actionResultTimeoutMs}. */
export const DEFAULT_ACTION_RESULT_TIMEOUT = 5000;

/**
 * Codes `sendActionWithResult` settles with when the host never got to
 * answer, alongside the host's own `ErrorCodes`.
 */
export const ClientActionErrorCodes = {
  /** There was no open connection; the action was not sent. */
  NOT_CONNECTED: "NOT_CONNECTED",
  /** The connection closed before the host answered. */
  DISCONNECTED: "DISCONNECTED",
  /** No answer within `actionResultTimeoutMs`. The action may have applied. */
  NO_RESULT: "NO_RESULT",
} as const;

/**
 * React hook that connects the web controller to the TV host via WebSocket.
 *
 * Manages the full lifecycle: connection, JOIN handshake, session recovery,
 * optimistic state updates, server time synchronization, and automatic
 * reconnection with exponential backoff.
 *
 * @param config - Client configuration including reducer, initial state, and connection options.
 * @returns An object with `status`, `state`, `playerId`, `disconnectReason`, `sendAction`, `getServerTime`, `rtt`, `disconnect`, and `reconnect`.
 *
 * @example
 * ```tsx
 * const { state, sendAction } = useGameClient({
 *   reducer: gameReducer,
 *   initialState,
 * });
 * ```
 */
export function useGameClient<S extends IGameState, A extends IAction>(
  config: ClientConfig<S, A>,
) {
  const [status, setStatus] = useState<ClientStatus>("disconnected");
  const [playerId, setPlayerId] = useState<string | null>(null);
  /**
   * Why the last connection ended, when the transport knows. For the relay this
   * is a {@link RelayErrorCodes} value such as `ROOM_NOT_FOUND`.
   */
  const [disconnectReason, setDisconnectReason] = useState<string | null>(null);

  // Local Optimistic State
  // Wrap the user's reducer with createGameReducer to handle HYDRATE automatically.
  // With no reducer (server-projected views) the identity function keeps HYDRATE
  // working while local application becomes a no-op.
  const [state, dispatchLocal] = useReducer(
    createGameReducer(config.reducer ?? ((current: S) => current)),
    config.initialState,
  );

  const socketRef = useRef<ClientTransport | null>(null);
  // The transport once it is open, as state: time sync has to re-run when the
  // socket *opens*, and a ref read during render cannot signal that.
  const [openTransport, setOpenTransport] = useState<ClientTransport | null>(
    null,
  );
  // Last state the host sent, and the pending fallback to it (see
  // `optimisticTimeoutMs`).
  const lastServerState = useRef<S | null>(null);
  const rollbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);
  // sendActionWithResult calls waiting on the host's ACTION_RESULT, by id.
  const pendingResults = useRef(
    new Map<
      string,
      {
        settle: (result: ActionResult) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >(),
  );
  const nextActionId = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalClose = useRef(false);
  // The last close may be retried: not intentional, not a final close code.
  // What resuming the page acts on once the backoff has given up.
  const resumable = useRef(false);

  // Keep refs for values used inside connect() to avoid stale closures
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  });

  // Time Sync Hook
  const { getServerTime, rtt, handlePong } = useServerTime(
    config.timeSync === false ? null : openTransport,
  );

  const handlePongRef = useRef(handlePong);
  useEffect(() => {
    handlePongRef.current = handlePong;
  });

  const cancelRollback = useCallback(() => {
    if (rollbackTimer.current !== null) {
      clearTimeout(rollbackTimer.current);
      rollbackTimer.current = null;
    }
  }, []);

  /** Replaces local state with the last state the host sent, if any. */
  const rollbackToServerState = useCallback(() => {
    cancelRollback();
    const serverState = lastServerState.current;
    if (serverState === null) return;
    dispatchLocal({
      type: InternalActionTypes.HYDRATE,
      payload: serverState,
    } as InternalAction<S>);
  }, [cancelRollback]);

  /** Settles one pending result, if it is still waiting. */
  const settleResult = useCallback((id: string, result: ActionResult) => {
    const pending = pendingResults.current.get(id);
    if (!pending) return;
    pendingResults.current.delete(id);
    clearTimeout(pending.timer);
    pending.settle(result);
  }, []);

  /** A connection ended: nothing still waiting will be answered on it. */
  const settleAllPending = useCallback(() => {
    for (const id of [...pendingResults.current.keys()]) {
      settleResult(id, {
        ok: false,
        code: ClientActionErrorCodes.DISCONNECTED,
        message: "The connection closed before the host answered",
      });
    }
  }, [settleResult]);

  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelay = config.baseDelay ?? DEFAULT_BASE_DELAY;
  const maxDelay = config.maxDelay ?? DEFAULT_MAX_DELAY;

  const connect = useCallback(() => {
    const cfg = configRef.current;
    intentionalClose.current = false;

    // 1. Build the transport.
    // If a custom transport factory is provided (e.g. a cross-network relay),
    // use it. Otherwise fall back to the default LAN WebSocket:
    //   - If an explicit URL is provided, use it.
    //   - Otherwise derive the WebSocket URL from window.location, assuming we
    //     are served by the Host's static server.
    //   Convention: WS port = HTTP port + 2 (e.g., HTTP 8080 -> WS 8082).
    //   Port + 1 is skipped to avoid conflicts with Metro bundler (uses 8081).
    let transport: ClientTransport;
    if (cfg.createTransport) {
      if (cfg.debug)
        console.log("[GameClient] Connecting via custom transport");
      transport = cfg.createTransport();
    } else {
      const wsUrl = resolveWebSocketUrl(
        { url: cfg.url, wsPort: cfg.wsPort },
        typeof window !== "undefined" ? window.location : null,
      );

      if (!wsUrl) return;

      if (cfg.debug) console.log(`[GameClient] Connecting to ${wsUrl}`);
      transport = createWebSocketTransport(wsUrl);
    }

    socketRef.current = transport;
    setStatus("connecting");
    setDisconnectReason(null);

    // Every handler ignores a transport that is no longer the current one. A
    // socket closed by cleanup, `disconnect()` or a reconnect still fires its
    // events later; without this they would overwrite the new connection's
    // status and schedule a second, parallel reconnect.
    const isCurrent = () => socketRef.current === transport;

    transport.onopen = () => {
      if (!isCurrent()) return;
      const currentCfg = configRef.current;
      setStatus("connected");
      setDisconnectReason(null);
      setOpenTransport(transport);
      reconnectAttempts.current = 0;
      currentCfg.onConnect?.();

      // Session Recovery Logic -- use cryptographically random secrets
      const secret = resolveSessionSecret(
        typeof localStorage !== "undefined" ? localStorage : null,
        undefined,
        transport.sessionScope ?? currentCfg.sessionScope,
      );

      // Join with secret
      try {
        transport.send(
          JSON.stringify({
            type: MessageTypes.JOIN,
            payload: {
              name: currentCfg.name || "Player",
              avatar: currentCfg.avatar || "\u{1F600}",
              secret,
            },
          }),
        );
      } catch (e) {
        if (currentCfg.debug)
          console.error("[GameClient] Failed to send JOIN:", e);
      }
    };

    transport.onmessage = (data) => {
      if (!isCurrent()) return;
      let msg: HostMessage;
      try {
        msg = JSON.parse(data) as HostMessage;
      } catch (e) {
        console.error("Failed to parse message", e);
        return;
      }

      for (const effect of interpretHostMessage<S>(msg)) {
        switch (effect.kind) {
          case "setPlayerId":
            setPlayerId(effect.playerId);
            break;
          case "hydrate":
            // Full state replacement from the host's authoritative state. It
            // supersedes any optimistic update, so no fallback is needed.
            lastServerState.current = effect.state;
            cancelRollback();
            dispatchLocal({
              type: InternalActionTypes.HYDRATE,
              payload: effect.state,
            } as InternalAction<S>);
            break;
          case "pong":
            handlePongRef.current(effect.payload);
            break;
          case "error":
            if (configRef.current.debug)
              console.warn("[GameClient] Host error:", effect.error);
            // Whatever was rejected, the host's state did not change: drop
            // any optimistic update now instead of waiting out the timer.
            rollbackToServerState();
            configRef.current.onError?.(effect.error);
            break;
          case "actionResult":
            if (!effect.result.ok) {
              // A refusal is still an error for onError's purposes; only the
              // channel it arrived on differs.
              rollbackToServerState();
              configRef.current.onError?.({
                code: effect.result.code,
                message: effect.result.message,
              });
            }
            settleResult(effect.id, effect.result);
            break;
        }
      }
    };

    transport.onclose = (code, reason) => {
      if (!isCurrent()) return;
      settleAllPending();
      socketRef.current = null;
      setOpenTransport(null);
      setStatus("disconnected");
      // Terminal room-level failures carry a relay error code (ROOM_NOT_FOUND,
      // ROOM_FULL, …). Surfacing it lets the UI explain the failure rather than
      // sit on "connecting" forever.
      setDisconnectReason(reason ? reason : null);
      resumable.current = !intentionalClose.current && isRecoverableClose(code);
      configRef.current.onDisconnect?.();

      // Don't reconnect if the close was intentional or if the server
      // sent a policy/unexpected error close code, or once retries are exhausted.
      if (
        !shouldReconnect({
          intentionalClose: intentionalClose.current,
          closeCode: code,
          attempts: reconnectAttempts.current,
          maxRetries,
        })
      )
        return;

      // Exponential backoff reconnection
      const delay = computeBackoffDelay(
        reconnectAttempts.current,
        baseDelay,
        maxDelay,
      );
      reconnectAttempts.current++;

      if (configRef.current.debug)
        console.log(`[GameClient] Reconnecting in ${delay}ms...`);

      reconnectTimer.current = setTimeout(() => {
        connect();
      }, delay);
    };

    transport.onerror = (e) => {
      if (!isCurrent()) return;
      if (configRef.current.debug) console.error("[GameClient] Error", e);
      setStatus("error");
    };
    // Only re-create the connect function when what it connects to changes:
    // URL/port, or the caller's connectionKey. Config values like name,
    // avatar, callbacks, and createTransport are read from configRef.
  }, [
    config.url,
    config.wsPort,
    config.connectionKey,
    maxRetries,
    baseDelay,
    maxDelay,
    cancelRollback,
    rollbackToServerState,
    settleResult,
    settleAllPending,
  ]);

  /**
   * Closes the current transport for good. It is detached *before* closing, so
   * its late `close`/`error` events are ignored and cannot trigger a reconnect
   * or clobber the status of whatever connection replaces it.
   */
  const closeCurrent = useCallback(() => {
    intentionalClose.current = true;
    resumable.current = false;
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    cancelRollback();
    settleAllPending();
    const transport = socketRef.current;
    if (!transport) return;
    socketRef.current = null;
    setOpenTransport(null);
    transport.close();
    configRef.current.onDisconnect?.();
  }, [cancelRollback, settleAllPending]);

  // Initial connection, and a fresh one (with a fresh retry budget) whenever
  // the target changes.
  useEffect(() => {
    reconnectAttempts.current = 0;
    connect();
    return closeCurrent;
  }, [connect, closeCurrent]);

  // Resume: a phone that slept, or lost its network, may have used up every
  // retry while it could not connect. Try again the moment it is back.
  useEffect(() => {
    if (config.reconnectOnResume === false) return;
    if (typeof window === "undefined") return;

    const resume = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      // A live or connecting transport needs nothing; a final close stays final.
      if (socketRef.current || !resumable.current) return;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      if (configRef.current.debug)
        console.log("[GameClient] Page resumed, reconnecting");
      reconnectAttempts.current = 0;
      connect();
    };

    document?.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    window.addEventListener("pageshow", resume);
    return () => {
      document?.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("pageshow", resume);
    };
  }, [connect, config.reconnectOnResume]);

  /**
   * Manually disconnect from the host.
   * Prevents automatic reconnection.
   */
  const disconnect = useCallback(() => {
    closeCurrent();
    setStatus("disconnected");
  }, [closeCurrent]);

  /**
   * Manually reconnect to the host.
   * Resets the reconnection attempt counter.
   */
  const reconnect = useCallback(() => {
    closeCurrent();
    reconnectAttempts.current = 0;
    connect();
  }, [closeCurrent, connect]);

  /**
   * Sends an action to the host, applying it locally first when a `reducer`
   * is configured.
   *
   * @returns `true` if the action was sent, `false` if there is no open
   *   connection. Nothing is queued, and no optimistic update is applied, for
   *   an action that was not sent. Sent actions can still be rejected by the
   *   host; those arrive through `onError`.
   */
  const sendActionMessage = useCallback(
    (action: A, id?: string): boolean => {
      const transport = socketRef.current;
      if (transport?.readyState !== TransportReadyState.OPEN) {
        if (configRef.current.debug)
          console.warn("[GameClient] Not connected, action dropped:", action);
        return false;
      }

      // 1. Optimistic Update
      dispatchLocal(action);

      // The host stays silent when an action changes nothing, so an optimistic
      // update it ignored would otherwise stand forever. Arm a single fallback to
      // the last server state; the next STATE_UPDATE cancels it.
      const cfg = configRef.current;
      const timeout = cfg.optimisticTimeoutMs ?? DEFAULT_OPTIMISTIC_TIMEOUT;
      if (cfg.reducer && timeout > 0 && rollbackTimer.current === null) {
        rollbackTimer.current = setTimeout(() => {
          rollbackTimer.current = null;
          rollbackToServerState();
        }, timeout);
      }

      // 2. Send to Host
      try {
        transport.send(
          JSON.stringify(
            id === undefined
              ? { type: MessageTypes.ACTION, payload: action }
              : { type: MessageTypes.ACTION, payload: action, id },
          ),
        );
      } catch (e) {
        if (configRef.current.debug)
          console.error("[GameClient] Failed to send action:", e);
        rollbackToServerState();
        return false;
      }
      return true;
    },
    [rollbackToServerState],
  );

  const sendAction = useCallback(
    (action: A): boolean => sendActionMessage(action),
    [sendActionMessage],
  );

  /**
   * Like `sendAction`, but resolves with the host's verdict on this action:
   * `{ ok: true }` once applied, or `{ ok: false, code, message }` when the
   * host refused it (the game's `authorizeAction`, a reducer that threw, rate
   * limiting) or never got to answer (`NOT_CONNECTED`, `DISCONNECTED`,
   * `NO_RESULT`). Never rejects.
   *
   * Await it to keep a button disabled until the host has answered, so a
   * double tap sends one action, and to show a refusal where it happened.
   * Refusals also reach `onError`.
   */
  const sendActionWithResult = useCallback(
    (action: A): Promise<ActionResult> => {
      const id = `a${++nextActionId.current}`;
      return new Promise<ActionResult>((resolve) => {
        const timeout =
          configRef.current.actionResultTimeoutMs ??
          DEFAULT_ACTION_RESULT_TIMEOUT;
        const timer = setTimeout(() => {
          settleResult(id, {
            ok: false,
            code: ClientActionErrorCodes.NO_RESULT,
            message: "The host did not answer in time",
          });
        }, timeout);
        pendingResults.current.set(id, { settle: resolve, timer });

        if (!sendActionMessage(action, id)) {
          settleResult(id, {
            ok: false,
            code: ClientActionErrorCodes.NOT_CONNECTED,
            message: "Not connected to the host",
          });
        }
      });
    },
    [sendActionMessage, settleResult],
  );

  return {
    status,
    state,
    playerId,
    /**
     * Why the last connection ended, if the transport reported a cause — for
     * the relay, a `RelayErrorCodes` value like `ROOM_NOT_FOUND` or `ROOM_FULL`.
     * `null` when connected or when the cause is unknown.
     */
    disconnectReason,
    sendAction,
    sendActionWithResult,
    getServerTime,
    /** Round-trip time (ms) to the server. Updated periodically via PING/PONG. */
    rtt,
    /** Manually disconnect from the host. Prevents automatic reconnection. */
    disconnect,
    /** Manually reconnect to the host. Resets the reconnection attempt counter. */
    reconnect,
  };
}

/** What {@link useGameClient} returns. */
export type UseGameClientResult<
  S extends IGameState,
  A extends IAction,
> = ReturnType<typeof useGameClient<S, A>>;
