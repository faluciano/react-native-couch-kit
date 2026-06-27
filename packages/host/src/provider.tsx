import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useCallback,
} from "react";
import { GameWebSocketServer } from "./websocket";
import { useStaticServer } from "./server";
import {
  MessageTypes,
  InternalActionTypes,
  DEFAULT_HTTP_PORT,
  DEFAULT_WS_PORT_OFFSET,
  DEFAULT_DISCONNECT_TIMEOUT,
  createGameReducer,
  isValidSecret,
  type IGameState,
  type IAction,
  type InternalAction,
} from "@couch-kit/core";
import { isValidClientMessage } from "./message-validation";
import { ActionRateLimiter } from "./rate-limiter";
import {
  HostSessionManager,
  type JoinSessionPayload,
} from "./session-manager";
import {
  BroadcastScheduler,
  DEFAULT_STATE_THROTTLE_MS,
  createStateUpdateMessage,
} from "./broadcast-scheduler";

export interface GameHostConfig<S extends IGameState, A extends IAction> {
  initialState: S;
  reducer: (state: S, action: A) => S;
  port?: number; // Static server port (default 8080)
  wsPort?: number; // WebSocket port (default: HTTP port + 2, i.e. 8082)
  devMode?: boolean;
  devServerUrl?: string;
  staticDir?: string; // Override the default www directory path (required on Android)
  debug?: boolean;
  /** Timeout (ms) before a disconnected player is permanently removed (default: 5 minutes). */
  disconnectTimeout?: number;
  /** State broadcast throttle interval in milliseconds (default: 33ms, ~30fps). */
  stateThrottleMs?: number;
  /** Called when a player successfully joins. */
  onPlayerJoined?: (playerId: string, name: string) => void;
  /** Called when a player disconnects. */
  onPlayerLeft?: (playerId: string) => void;
  /** Called when a server error occurs. */
  onError?: (error: Error) => void;
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

/**
 * React context provider that turns a React Native TV app into a local game server.
 *
 * Starts a static file server (for the web controller) and a WebSocket game server
 * (for real-time state sync). Manages the canonical game state using the provided
 * reducer and broadcasts state updates to all connected clients.
 *
 * @param config - Host configuration including reducer, initial state, ports, and callbacks.
 *
 * @example
 * ```tsx
 * <GameHostProvider config={{ reducer: gameReducer, initialState }}>
 *   <GameScreen />
 * </GameHostProvider>
 * ```
 */
export function GameHostProvider<S extends IGameState, A extends IAction>({
  children,
  config,
}: {
  children: React.ReactNode;
  config: GameHostConfig<S, A>;
}) {
  // Wrap the user's reducer with createGameReducer to handle internal actions
  // (HYDRATE, PLAYER_JOINED, PLAYER_LEFT) automatically.
  const [state, dispatch] = useReducer(
    createGameReducer(config.reducer),
    config.initialState,
  );

  // Keep a ref to state so we can access it inside callbacks/effects that don't depend on it
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Send WELCOME/RECONNECTED messages after state has settled (post-render).
  // This guarantees the joining player is included in the state snapshot.
  useEffect(() => {
    if (pendingWelcome.current.size === 0) return;
    if (!wsServer.current) return;

    if (configRef.current.debug) {
      console.log(
        `[GameHost] Sending WELCOME/RECONNECTED to ${pendingWelcome.current.size} client(s)`,
      );
    }

    const server = wsServer.current;
    for (const [
      socketId,
      { playerId, isReconnect },
    ] of pendingWelcome.current) {
      welcomedClients.current.add(socketId);
      if (isReconnect) {
        server.send(socketId, {
          type: MessageTypes.RECONNECTED,
          payload: {
            playerId,
            state,
          },
        });
      } else {
        server.send(socketId, {
          type: MessageTypes.WELCOME,
          payload: {
            playerId,
            state,
            serverTime: Date.now(),
          },
        });
      }
    }
    pendingWelcome.current.clear();
  }, [state]);

  // Keep refs for callback props to avoid stale closures
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  });

  // 1. Start Static File Server
  const httpPort = config.port || DEFAULT_HTTP_PORT;
  const { url: serverUrl, error: serverError } = useStaticServer({
    port: httpPort,
    devMode: config.devMode,
    devServerUrl: config.devServerUrl,
    staticDir: config.staticDir,
  });

  // 2. Start WebSocket Server (Convention: HTTP port + 2, avoids Metro on 8081)
  const wsServer = useRef<GameWebSocketServer | null>(null);

  const sessionManager = useRef(
    new HostSessionManager({
      getDisconnectTimeout: () =>
        configRef.current.disconnectTimeout ?? DEFAULT_DISCONNECT_TIMEOUT,
    }),
  );

  // Track socket IDs that have received their WELCOME message
  const welcomedClients = useRef<Set<string>>(new Set());

  // Track socket IDs that need a WELCOME/RECONNECTED message after state settles
  const pendingWelcome = useRef<
    Map<string, { playerId: string; isReconnect: boolean }>
  >(new Map());

  // Track which players have finished loading assets
  const assetsLoaded = useRef<Map<string, boolean>>(new Map());

  // Queue of actions dispatched since last broadcast (for STATE_UPDATE.action)
  const actionQueue = useRef<unknown[]>([]);

  const rateLimiter = useRef(new ActionRateLimiter());

  useEffect(() => {
    const port = config.wsPort || httpPort + DEFAULT_WS_PORT_OFFSET;
    const server = new GameWebSocketServer({ port, debug: config.debug });

    // Start the WebSocket server asynchronously
    server.start().catch((error) => {
      if (configRef.current.debug) {
        console.error("[GameHost] Failed to start WebSocket server:", error);
      }
      configRef.current.onError?.(error);
    });
    wsServer.current = server;

    server.on("listening", (p) => {
      if (configRef.current.debug)
        console.log(`[GameHost] WebSocket listening on port ${p}`);
    });

    server.on("connection", (socketId) => {
      if (configRef.current.debug)
        console.log(`[GameHost] Client connected: ${socketId}`);
    });

    server.on("message", (socketId, rawMessage) => {
      // Validate message structure before processing
      if (!isValidClientMessage(rawMessage)) {
        if (configRef.current.debug)
          console.warn(
            `[GameHost] Invalid message from ${socketId}:`,
            rawMessage,
          );
        server.send(socketId, {
          type: MessageTypes.ERROR,
          payload: { code: "INVALID_MESSAGE", message: "Malformed message" },
        });
        return;
      }

      const message = rawMessage;

      if (configRef.current.debug)
        console.log(`[GameHost] Msg from ${socketId}:`, message);

      switch (message.type) {
        case MessageTypes.JOIN: {
          const { secret, ...payload } = message.payload;

          // Validate secret format
          if (
            !secret ||
            typeof secret !== "string" ||
            !isValidSecret(secret)
          ) {
            server.send(socketId, {
              type: MessageTypes.ERROR,
              payload: {
                code: "INVALID_SECRET",
                message: "Invalid or missing session secret",
              },
            });
            return;
          }

          sessionManager.current
            .handleJoin<S>(
              socketId,
              message.payload as JoinSessionPayload,
              () => stateRef.current.players,
            )
            .then(({ playerId, isReconnect, action }) => {
              dispatch(action);

              // Initialize/reset assets loaded status
              assetsLoaded.current.set(playerId, false);

              // Queue WELCOME/RECONNECTED message
              pendingWelcome.current.set(socketId, {
                playerId,
                isReconnect,
              });

              configRef.current.onPlayerJoined?.(playerId, payload.name);
            })
            .catch((err) => {
              if (configRef.current.debug) {
                console.error("[GameHost] Failed to derive player ID:", err);
              }
              server.send(socketId, {
                type: MessageTypes.ERROR,
                payload: {
                  code: "JOIN_FAILED",
                  message: "Failed to process join request",
                },
              });
            });
          break;
        }

        case MessageTypes.ACTION: {
          // Only accept actions with a user-defined type string,
          // reject internal action types to prevent injection.
          const actionPayload = message.payload as A;
          if (
            actionPayload.type === InternalActionTypes.HYDRATE ||
            actionPayload.type === InternalActionTypes.PLAYER_JOINED ||
            actionPayload.type === InternalActionTypes.PLAYER_LEFT ||
            actionPayload.type === InternalActionTypes.PLAYER_RECONNECTED ||
            actionPayload.type === InternalActionTypes.PLAYER_REMOVED
          ) {
            if (configRef.current.debug)
              console.warn(
                `[GameHost] Rejected internal action from ${socketId}:`,
                actionPayload.type,
              );
            server.send(socketId, {
              type: MessageTypes.ERROR,
              payload: {
                code: "FORBIDDEN_ACTION",
                message:
                  "Internal action types cannot be dispatched by clients",
              },
            });
            return;
          }

          // Rate limiting
          if (!rateLimiter.current.record(socketId).allowed) {
            if (configRef.current.debug)
              console.warn(`[GameHost] Rate limited ${socketId}`);
            server.send(socketId, {
              type: MessageTypes.ERROR,
              payload: {
                code: "RATE_LIMITED",
                message: "Too many actions, slow down",
              },
            });
            return;
          }

          // Use cached playerId (populated at JOIN time)
          const resolvedPlayerId =
            sessionManager.current.getPlayerIdForSocket(socketId);
          dispatch({ ...actionPayload, playerId: resolvedPlayerId });
          actionQueue.current.push(actionPayload);
          break;
        }

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

        case MessageTypes.ASSETS_LOADED: {
          const loadedPlayerId =
            sessionManager.current.getPlayerIdForSocket(socketId);
          if (loadedPlayerId) {
            assetsLoaded.current.set(loadedPlayerId, true);
            if (configRef.current.debug)
              console.log(`[GameHost] Assets loaded for ${loadedPlayerId}`);
          }
          break;
        }
      }
    });

    server.on("disconnect", (socketId) => {
      if (configRef.current.debug)
        console.log(`[GameHost] Client disconnected: ${socketId}`);

      welcomedClients.current.delete(socketId);

      // Clean up rate limits
      rateLimiter.current.reset(socketId);

      const result = sessionManager.current.handleDisconnect<S>(socketId);
      if (result.kind === "unknown") return; // Unknown socket, nothing to do

      // Clean up assets loaded tracking
      assetsLoaded.current.delete(result.playerId);

      if (result.kind === "stale") {
        // Player already reconnected on a newer socket — skip
        return;
      }

      // Mark disconnected (don't remove from sessions — allow reconnect)
      dispatch(result.action);

      configRef.current.onPlayerLeft?.(result.playerId);

      // Start stale player cleanup timer
      sessionManager.current.scheduleRemoval(
        result.playerId,
        result.secret,
        (playerId) => {
          dispatch({
            type: InternalActionTypes.PLAYER_REMOVED,
            payload: { playerId },
          } as InternalAction<S>);
        },
      );
    });

    server.on("error", (error) => {
      if (configRef.current.debug)
        console.error(`[GameHost] Server error:`, error);
      configRef.current.onError?.(error);
    });

    return () => {
      server.stop();
      sessionManager.current.clearRemovalTimers();
    };
  }, []); // Run once on mount

  // 3. Throttled State Broadcasts (~30fps)
  // Batches rapid state changes so at most one broadcast is sent per ~33ms frame,
  // reducing serialization overhead and network traffic for fast-updating games.
  const broadcastScheduler = useRef(
    new BroadcastScheduler({
      stateThrottleMs: config.stateThrottleMs,
    }),
  );

  useEffect(() => {
    broadcastScheduler.current.setStateThrottleMs(
      config.stateThrottleMs ?? DEFAULT_STATE_THROTTLE_MS,
    );
  }, [config.stateThrottleMs]);

  const broadcastState = useCallback(() => {
    if (wsServer.current) {
      const actions = actionQueue.current;
      actionQueue.current = [];
      wsServer.current.broadcast(
        createStateUpdateMessage(stateRef.current, actions),
      );
    }
  }, []);

  useEffect(() => {
    // Cancel any pending broadcast and schedule a fresh one.
    // This ensures the broadcast always uses the latest stateRef.
    broadcastScheduler.current.schedule(broadcastState);

    return () => {
      broadcastScheduler.current.cancel();
    };
  }, [state, broadcastState]);

  // Memoize context value to prevent unnecessary re-renders of consumers
  // that only use stable references like dispatch
  const contextValue = useMemo(
    () => ({ state, dispatch, serverUrl, serverError }),
    [state, serverUrl, serverError],
  );

  return (
    <GameHostContext.Provider value={contextValue}>
      {children}
    </GameHostContext.Provider>
  );
}

/**
 * React hook to access the game host context.
 *
 * Must be used within a `<GameHostProvider>`. Returns the canonical game state,
 * a dispatch function for actions, the server URL (for QR codes), and any
 * server startup errors.
 *
 * @returns An object with `state`, `dispatch`, `serverUrl`, and `serverError`.
 * @throws If used outside of a `<GameHostProvider>`.
 */
export function useGameHost<S extends IGameState, A extends IAction>() {
  const context = useContext(GameHostContext);
  if (!context) {
    throw new Error("useGameHost must be used within a GameHostProvider");
  }
  return context as GameHostContextValue<S, A>;
}
