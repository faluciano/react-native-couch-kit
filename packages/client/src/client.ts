import { useState, useEffect, useRef, useCallback, useReducer } from "react";
import {
  MessageTypes,
  InternalActionTypes,
  DEFAULT_WS_PORT_OFFSET,
  DEFAULT_MAX_RETRIES,
  DEFAULT_BASE_DELAY,
  DEFAULT_MAX_DELAY,
  generateId,
  createGameReducer,
  type HostMessage,
  type IGameState,
  type IAction,
  type InternalAction,
} from "@couch-kit/core";
import { useServerTime } from "./time-sync";

export interface ClientConfig<S extends IGameState, A extends IAction> {
  url?: string; // Full WebSocket URL (overrides auto-detection)
  wsPort?: number; // WebSocket port (default: auto-detected as HTTP port + 2)
  reducer: (state: S, action: A | InternalAction<S>) => S;
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
    let wsUrl = cfg.url;

    if (!wsUrl && typeof window !== "undefined") {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.hostname;
      const httpPort = parseInt(window.location.port, 10) || 80;
      const wsPort = cfg.wsPort || httpPort + DEFAULT_WS_PORT_OFFSET;
      wsUrl = `${protocol}//${host}:${wsPort}`;
    }

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
      let secret: string | null = null;
      try {
        secret = localStorage.getItem("ck_secret");
        if (!secret) {
          secret = generateId();
          localStorage.setItem("ck_secret", secret);
        }
      } catch {
        // localStorage unavailable (Safari private browsing, restrictive WebViews, etc.)
        secret = generateId();
      }

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
      try {
        const msg = JSON.parse(event.data) as HostMessage;

        switch (msg.type) {
          case MessageTypes.WELCOME:
            setPlayerId(msg.payload.playerId);
            // Hydrate state from server (Single Source of Truth)
            dispatchLocal({
              type: InternalActionTypes.HYDRATE,
              payload: msg.payload.state as S,
            } as InternalAction<S>);
            break;

          case MessageTypes.STATE_UPDATE:
            // Full state replacement from the host's authoritative state.
            dispatchLocal({
              type: InternalActionTypes.HYDRATE,
              payload: msg.payload.newState as S,
            } as InternalAction<S>);
            break;

          case MessageTypes.PONG:
            handlePong(msg.payload);
            break;
        }
      } catch (e) {
        console.error("Failed to parse message", e);
      }
    };

    ws.onclose = (event) => {
      setStatus("disconnected");
      configRef.current.onDisconnect?.();

      // Don't reconnect if the close was intentional or if the server
      // sent a policy/unexpected error close code
      if (intentionalClose.current) return;
      if (event.code === 1008 || event.code === 1011) return;

      // Exponential backoff reconnection
      if (reconnectAttempts.current < maxRetries) {
        const delay = Math.min(
          baseDelay * Math.pow(2, reconnectAttempts.current),
          maxDelay,
        );
        reconnectAttempts.current++;

        if (configRef.current.debug)
          console.log(`[GameClient] Reconnecting in ${delay}ms...`);

        reconnectTimer.current = setTimeout(() => {
          connect();
        }, delay);
      }
    };

    ws.onerror = (e) => {
      if (configRef.current.debug) console.error("[GameClient] Error", e);
      setStatus("error");
    };
    // Only re-create the connect function when URL/port actually changes.
    // Config values like name, avatar, callbacks are read from configRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
