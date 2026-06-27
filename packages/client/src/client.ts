import { useState, useEffect, useRef, useCallback, useReducer } from "react";
import {
  MessageTypes,
  InternalActionTypes,
  DEFAULT_MAX_RETRIES,
  DEFAULT_BASE_DELAY,
  DEFAULT_MAX_DELAY,
  createGameReducer,
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
  resolveSessionSecret,
  interpretHostMessage,
} from "./connection";

export interface ClientConfig<S extends IGameState, A extends IAction> {
  url?: string; // Full WebSocket URL (overrides auto-detection)
  wsPort?: number; // WebSocket port (default: auto-detected as HTTP port + 2)
  reducer: (state: S, action: A) => S;
  initialState: S;
  name?: string; // Player display name (default: "Player")
  avatar?: string; // Player avatar emoji (default: "\u{1F600}")
  /** Maximum reconnection attempts before giving up (default: 5). */
  maxRetries?: number;
  /** Base delay (ms) for exponential backoff reconnection (default: 1000). */
  baseDelay?: number;
  /** Maximum delay (ms) cap for reconnection backoff (default: 10000). */
  maxDelay?: number;
  onConnect?: () => void;
  onDisconnect?: () => void;
  debug?: boolean;
}

/**
 * React hook that connects the web controller to the TV host via WebSocket.
 *
 * Manages the full lifecycle: connection, JOIN handshake, session recovery,
 * optimistic state updates, server time synchronization, and automatic
 * reconnection with exponential backoff.
 *
 * @param config - Client configuration including reducer, initial state, and connection options.
 * @returns An object with `status`, `state`, `playerId`, `sendAction`, `getServerTime`, `rtt`, `disconnect`, and `reconnect`.
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
  const [status, setStatus] = useState<
    "connecting" | "connected" | "disconnected" | "error"
  >("disconnected");
  const [playerId, setPlayerId] = useState<string | null>(null);

  // Local Optimistic State
  // Wrap the user's reducer with createGameReducer to handle HYDRATE automatically
  const [state, dispatchLocal] = useReducer(
    createGameReducer(config.reducer),
    config.initialState,
  );

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalClose = useRef(false);

  // Keep refs for values used inside connect() to avoid stale closures
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  });

  // Time Sync Hook
  const { getServerTime, rtt, handlePong } = useServerTime(socketRef.current);

  const handlePongRef = useRef(handlePong);
  useEffect(() => {
    handlePongRef.current = handlePong;
  });

  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelay = config.baseDelay ?? DEFAULT_BASE_DELAY;
  const maxDelay = config.maxDelay ?? DEFAULT_MAX_DELAY;

  const connect = useCallback(() => {
    const cfg = configRef.current;
    intentionalClose.current = false;

    // 1. Magic Client: Determine URL
    // If explicit URL provided, use it.
    // Otherwise, assume we are being served by the Host's static server,
    // so derive the WebSocket URL from window.location.
    // Convention: WS port = HTTP port + 2 (e.g., HTTP 8080 -> WS 8082)
    // Port + 1 is skipped to avoid conflicts with Metro bundler (which uses 8081)
    const wsUrl = resolveWebSocketUrl(
      { url: cfg.url, wsPort: cfg.wsPort },
      typeof window !== "undefined" ? window.location : null,
    );

    if (!wsUrl) return;

    if (cfg.debug) console.log(`[GameClient] Connecting to ${wsUrl}`);
    setStatus("connecting");

    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      const currentCfg = configRef.current;
      setStatus("connected");
      reconnectAttempts.current = 0;
      currentCfg.onConnect?.();

      // Session Recovery Logic -- use cryptographically random secrets
      const secret = resolveSessionSecret(
        typeof localStorage !== "undefined" ? localStorage : null,
      );

      // Join with secret
      try {
        ws.send(
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

    ws.onmessage = (event) => {
      let msg: HostMessage;
      try {
        msg = JSON.parse(event.data) as HostMessage;
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
            // Full state replacement from the host's authoritative state.
            dispatchLocal({
              type: InternalActionTypes.HYDRATE,
              payload: effect.state,
            } as InternalAction<S>);
            break;
          case "pong":
            handlePongRef.current(effect.payload);
            break;
        }
      }
    };

    ws.onclose = (event) => {
      setStatus("disconnected");
      configRef.current.onDisconnect?.();

      // Don't reconnect if the close was intentional or if the server
      // sent a policy/unexpected error close code, or once retries are exhausted.
      if (
        !shouldReconnect({
          intentionalClose: intentionalClose.current,
          closeCode: event.code,
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

    ws.onerror = (e) => {
      if (configRef.current.debug) console.error("[GameClient] Error", e);
      setStatus("error");
    };
    // Only re-create the connect function when URL/port actually changes.
    // Config values like name, avatar, callbacks are read from configRef.
  }, [config.url, config.wsPort, maxRetries, baseDelay, maxDelay]);

  // Initial Connection
  useEffect(() => {
    connect();
    return () => {
      intentionalClose.current = true;
      if (socketRef.current) socketRef.current.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connect]);

  /**
   * Manually disconnect from the host.
   * Prevents automatic reconnection.
   */
  const disconnect = useCallback(() => {
    intentionalClose.current = true;
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    setStatus("disconnected");
  }, []);

  /**
   * Manually reconnect to the host.
   * Resets the reconnection attempt counter.
   */
  const reconnect = useCallback(() => {
    disconnect();
    reconnectAttempts.current = 0;
    // Small delay to let the close complete
    setTimeout(() => connect(), 50);
  }, [disconnect, connect]);

  // Action Dispatcher
  const sendAction = useCallback((action: A) => {
    // 1. Optimistic Update
    dispatchLocal(action);

    // 2. Send to Host
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: MessageTypes.ACTION,
          payload: action,
        }),
      );
    }
  }, []);

  return {
    status,
    state,
    playerId,
    sendAction,
    getServerTime,
    /** Round-trip time (ms) to the server. Updated periodically via PING/PONG. */
    rtt,
    /** Manually disconnect from the host. Prevents automatic reconnection. */
    disconnect,
    /** Manually reconnect to the host. Resets the reconnection attempt counter. */
    reconnect,
  };
}
