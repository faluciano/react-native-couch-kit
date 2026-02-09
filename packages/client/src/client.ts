import { useState, useEffect, useRef, useCallback, useReducer } from "react";
import {
  MessageTypes,
  type HostMessage,
  type IGameState,
  type IAction,
} from "@party-kit/core";
import { useServerTime } from "./time-sync";

// Reconnection Constants
const MAX_RETRIES = 5;
const BASE_DELAY = 1000;

interface ClientConfig<S extends IGameState, A extends IAction> {
  url?: string; // Full WebSocket URL (overrides auto-detection)
  wsPort?: number; // WebSocket port (default: auto-detected as HTTP port + 2)
  reducer: (state: S, action: A) => S;
  initialState: S;
  name?: string; // Player display name (default: "Player")
  avatar?: string; // Player avatar emoji (default: "😀")
  onConnect?: () => void;
  onDisconnect?: () => void;
  debug?: boolean;
}

import { createGameReducer } from "@party-kit/core";

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
  const reconnectTimer = useRef<Timer | null>(null);

  // Time Sync Hook
  const { getServerTime, handlePong } = useServerTime(socketRef.current);

  const connect = useCallback(() => {
    // 1. Magic Client: Determine URL
    // If explicit URL provided, use it.
    // Otherwise, assume we are being served by the Host's static server,
    // so derive the WebSocket URL from window.location.
    // Convention: WS port = HTTP port + 2 (e.g., HTTP 8080 → WS 8082)
    // Port + 1 is skipped to avoid conflicts with Metro bundler (which uses 8081)
    let wsUrl = config.url;

    if (!wsUrl && typeof window !== "undefined") {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.hostname;
      const httpPort = parseInt(window.location.port, 10) || 80;
      const wsPort = config.wsPort || httpPort + 2;
      wsUrl = `${protocol}//${host}:${wsPort}`;
    }

    if (!wsUrl) return;

    if (config.debug) console.log(`[GameClient] Connecting to ${wsUrl}`);
    setStatus("connecting");

    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      reconnectAttempts.current = 0;
      config.onConnect?.();

      // Session Recovery Logic
      let secret: string | null = null;
      try {
        secret = localStorage.getItem("pk_secret");
        if (!secret) {
          secret = Math.random().toString(36).substring(2, 15);
          localStorage.setItem("pk_secret", secret);
        }
      } catch {
        // localStorage unavailable (Safari private browsing, restrictive WebViews, etc.)
        secret = Math.random().toString(36).substring(2, 15);
      }

      // Join with secret
      ws.send(
        JSON.stringify({
          type: MessageTypes.JOIN,
          payload: {
            name: config.name || "Player",
            avatar: config.avatar || "\u{1F600}",
            secret,
          },
        }),
      );
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as HostMessage;

        switch (msg.type) {
          case MessageTypes.WELCOME:
            setPlayerId(msg.payload.playerId);
            // Hydrate state from server (Single Source of Truth)
            // The WELCOME payload contains the full authoritative game state.
            // Dispatch HYDRATE which is handled by createGameReducer in @party-kit/core.
            // @ts-expect-error - HYDRATE is an internal action managed by createGameReducer
            dispatchLocal({ type: "HYDRATE", payload: msg.payload.state });
            break;

          case MessageTypes.STATE_UPDATE:
            // Full state replacement from the host's authoritative state.
            // @ts-expect-error - HYDRATE is an internal action managed by createGameReducer
            dispatchLocal({ type: "HYDRATE", payload: msg.payload.newState });
            break;

          case MessageTypes.PONG:
            handlePong(msg.payload);
            break;
        }
      } catch (e) {
        console.error("Failed to parse message", e);
      }
    };

    ws.onclose = () => {
      setStatus("disconnected");
      config.onDisconnect?.();

      // Aggressive Reconnection Logic
      if (reconnectAttempts.current < MAX_RETRIES) {
        const delay = Math.min(
          BASE_DELAY * Math.pow(2, reconnectAttempts.current),
          10000,
        );
        reconnectAttempts.current++;

        if (config.debug)
          console.log(`[GameClient] Reconnecting in ${delay}ms...`);

        reconnectTimer.current = setTimeout(() => {
          connect();
        }, delay);
      }
    };

    ws.onerror = (e) => {
      if (config.debug) console.error("[GameClient] Error", e);
      setStatus("error");
    };
  }, [config.url, config.wsPort, config.debug]);

  // Initial Connection
  useEffect(() => {
    connect();
    return () => {
      if (socketRef.current) socketRef.current.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connect]);

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
  };
}
