import React, {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
} from "react";
import { GameWebSocketServer } from "./websocket";
import { useStaticServer } from "./server";
import {
  MessageTypes,
  type IGameState,
  type IAction,
  type ClientMessage,
} from "@party-kit/core";

interface GameHostConfig<S extends IGameState, A extends IAction> {
  initialState: S;
  reducer: (state: S, action: A) => S;
  port?: number; // Static server port (default 8080)
  wsPort?: number; // WebSocket port (default 8081)
  devMode?: boolean;
  devServerUrl?: string;
  staticDir?: string; // Override the default www directory path (required on Android)
  debug?: boolean;
}

interface GameHostContextValue<S extends IGameState, A extends IAction> {
  state: S;
  dispatch: (action: A) => void;
  serverUrl: string | null;
  serverError: Error | null;
}

// Create Context with 'any' fallback because Context generics are tricky in React
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GameHostContext = createContext<GameHostContextValue<any, any> | null>(
  null,
);

export function GameHostProvider<S extends IGameState, A extends IAction>({
  children,
  config,
}: {
  children: React.ReactNode;
  config: GameHostConfig<S, A>;
}) {
  const [state, dispatch] = useReducer(config.reducer, config.initialState);

  // Keep a ref to state so we can access it inside callbacks/effects that don't depend on it
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // 1. Start Static File Server (Port 8080)
  const { url: serverUrl, error: serverError } = useStaticServer({
    port: config.port || 8080,
    devMode: config.devMode,
    devServerUrl: config.devServerUrl,
    staticDir: config.staticDir,
  });

  // 2. Start WebSocket Server (Port 8081)
  const wsServer = useRef<GameWebSocketServer | null>(null);

  // Track active sessions: secret -> playerId
  const sessions = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const port = config.wsPort || 8081;
    const server = new GameWebSocketServer({ port, debug: config.debug });

    server.start();
    wsServer.current = server;

    server.on("listening", (p) => {
      if (config.debug)
        console.log(`[GameHost] WebSocket listening on port ${p}`);
    });

    server.on("connection", (socketId) => {
      if (config.debug) console.log(`[GameHost] Client connected: ${socketId}`);
    });

    server.on("message", (socketId, message: ClientMessage) => {
      if (config.debug)
        console.log(`[GameHost] Msg from ${socketId}:`, message);

      switch (message.type) {
        case MessageTypes.JOIN: {
          // Check for existing session
          const { secret, ...payload } = message.payload;

          if (secret) {
            // Update the session map with the new socket ID for this secret
            sessions.current.set(secret, socketId);
          }

          dispatch({
            type: "PLAYER_JOINED",
            payload: { id: socketId, secret, ...payload },
          } as unknown as A);

          server.send(socketId, {
            type: MessageTypes.WELCOME,
            payload: {
              playerId: socketId,
              state: stateRef.current,
              serverTime: Date.now(),
            },
          });
          break;
        }

        case MessageTypes.ACTION:
          dispatch(message.payload as A);
          break;

        case MessageTypes.PING:
          server.send(socketId, {
            type: MessageTypes.PONG,
            payload: {
              id: message.payload.id,
              origTimestamp: message.payload.timestamp,
              serverTime: Date.now(),
            },
          });
          break;
      }
    });

    server.on("disconnect", (socketId) => {
      if (config.debug)
        console.log(`[GameHost] Client disconnected: ${socketId}`);

      // We do NOT remove the session from the map here,
      // allowing them to reconnect later with the same secret.

      dispatch({
        type: "PLAYER_LEFT",
        payload: { playerId: socketId },
      } as unknown as A);
    });

    return () => {
      server.stop();
    };
  }, []); // Run once on mount

  // 3. Broadcast State Updates
  // Whenever React state changes, send it to all clients
  useEffect(() => {
    if (wsServer.current) {
      // Optimization: In the future, send deltas or only send if changed significantly
      wsServer.current.broadcast({
        type: MessageTypes.STATE_UPDATE,
        payload: {
          newState: state,
          timestamp: Date.now(),
        },
      });
    }
  }, [state]);

  // Keep stateRef in sync inside this effect too just in case (redundant but safe)
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  return (
    <GameHostContext.Provider
      value={{ state, dispatch, serverUrl, serverError }}
    >
      {children}
    </GameHostContext.Provider>
  );
}

export function useGameHost<S extends IGameState, A extends IAction>() {
  const context = useContext(GameHostContext);
  if (!context) {
    throw new Error("useGameHost must be used within a GameHostProvider");
  }
  return context as GameHostContextValue<S, A>;
}
