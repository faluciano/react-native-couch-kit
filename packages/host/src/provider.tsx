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
  derivePlayerId,
  derivePlayerIdLegacy,
  isValidSecret,
  type IGameState,
  type IAction,
  type InternalAction,
  type ClientMessage,
} from "@couch-kit/core";

/** Maximum actions per rate-limit window. */
const RATE_LIMIT_MAX = 60;

/** Rate-limit window duration (ms). */
const RATE_LIMIT_WINDOW = 1000;

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
 * Validates that an incoming message has the expected shape.
 * Returns true if the message is a valid ClientMessage, false otherwise.
 */
function isValidClientMessage(msg: unknown): msg is ClientMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  if (typeof m.type !== "string") return false;

  switch (m.type) {
    case MessageTypes.JOIN:
      return (
        typeof m.payload === "object" &&
        m.payload !== null &&
        typeof (m.payload as Record<string, unknown>).name === "string"
      );
    case MessageTypes.ACTION:
      return (
        typeof m.payload === "object" &&
        m.payload !== null &&
        typeof (m.payload as Record<string, unknown>).type === "string"
      );
    case MessageTypes.PING:
      return (
        typeof m.payload === "object" &&
        m.payload !== null &&
        typeof (m.payload as Record<string, unknown>).id === "string" &&
        typeof (m.payload as Record<string, unknown>).timestamp === "number"
      );
    case MessageTypes.ASSETS_LOADED:
      return m.payload === true;
    default:
      return false;
  }
}

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

  // Track active sessions: secret -> socketId
  const sessions = useRef<Map<string, string>>(new Map());

  // Reverse lookup: socketId -> secret (for disconnect resolution)
  const reverseMap = useRef<Map<string, string>>(new Map());

  // Stale player cleanup timers: playerId -> timer
  const cleanupTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  // Track socket IDs that have received their WELCOME message
  const welcomedClients = useRef<Set<string>>(new Set());

  // Track socket IDs that need a WELCOME/RECONNECTED message after state settles
  const pendingWelcome = useRef<
    Map<string, { playerId: string; isReconnect: boolean }>
  >(new Map());

  // Cache: socketId -> playerId (avoids async derivation in hot paths)
  const socketIdToPlayerId = useRef<Map<string, string>>(new Map());

  // Track which players have finished loading assets
  const assetsLoaded = useRef<Map<string, boolean>>(new Map());

  // Queue of actions dispatched since last broadcast (for STATE_UPDATE.action)
  const actionQueue = useRef<unknown[]>([]);

  // Rate limiting: track action count per socket
  const rateLimits = useRef<
    Map<string, { count: number; windowStart: number }>
  >(new Map());

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
          if (!secret || !isValidSecret(secret)) {
            server.send(socketId, {
              type: MessageTypes.ERROR,
              payload: {
                code: "INVALID_SECRET",
                message: "Invalid or missing session secret",
              },
            });
            return;
          }

          // Async dual-derivation: try SHA-256 first, fall back to legacy
          derivePlayerId(secret).then((hashedId) => {
            let playerId = hashedId;

            // Migration: if a player exists under the legacy ID, use that instead
            const legacyId = derivePlayerIdLegacy(secret);
            if (
              !stateRef.current.players[playerId] &&
              stateRef.current.players[legacyId]
            ) {
              playerId = legacyId;
            }

            // Cache the resolved playerId for this socket
            socketIdToPlayerId.current.set(socketId, playerId);

            // Update session maps
            sessions.current.set(secret, socketId);
            reverseMap.current.set(socketId, secret);

            // Cancel any pending cleanup timer for this player
            const existingTimer = cleanupTimers.current.get(playerId);
            if (existingTimer) {
              clearTimeout(existingTimer);
              cleanupTimers.current.delete(playerId);
            }

            // Check if this is a returning player
            const existingPlayer = stateRef.current.players[playerId];
            if (existingPlayer) {
              // Reconnection — restore existing player
              dispatch({
                type: InternalActionTypes.PLAYER_RECONNECTED,
                payload: { playerId },
              } as InternalAction<S>);

              // Reset assets loaded status on reconnect
              assetsLoaded.current.set(playerId, false);

              // Queue RECONNECTED message
              pendingWelcome.current.set(socketId, {
                playerId,
                isReconnect: true,
              });
            } else {
              // New player
              dispatch({
                type: InternalActionTypes.PLAYER_JOINED,
                payload: { id: playerId, ...payload },
              } as InternalAction<S>);

              // Initialize assets loaded status
              assetsLoaded.current.set(playerId, false);

              // Queue WELCOME message
              pendingWelcome.current.set(socketId, {
                playerId,
                isReconnect: false,
              });
            }

            configRef.current.onPlayerJoined?.(playerId, payload.name);
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
          const now = Date.now();
          let rateInfo = rateLimits.current.get(socketId);
          if (!rateInfo || now - rateInfo.windowStart > RATE_LIMIT_WINDOW) {
            rateInfo = { count: 0, windowStart: now };
            rateLimits.current.set(socketId, rateInfo);
          }
          rateInfo.count++;
          if (rateInfo.count > RATE_LIMIT_MAX) {
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
          const resolvedPlayerId = socketIdToPlayerId.current.get(socketId);
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
          const loadedPlayerId = socketIdToPlayerId.current.get(socketId);
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

      // Use cached playerId
      const playerId = socketIdToPlayerId.current.get(socketId);
      socketIdToPlayerId.current.delete(socketId);

      // Clean up reverse map
      const secret = reverseMap.current.get(socketId);
      reverseMap.current.delete(socketId);

      // Clean up rate limits
      rateLimits.current.delete(socketId);

      if (!playerId || !secret) return; // Unknown socket, nothing to do

      // Clean up assets loaded tracking
      assetsLoaded.current.delete(playerId);

      // RACE GUARD: Only mark as left if this socket is still the active one for this secret
      if (sessions.current.get(secret) !== socketId) {
        // Player already reconnected on a newer socket — skip
        return;
      }

      // Mark disconnected (don't remove from sessions — allow reconnect)
      dispatch({
        type: InternalActionTypes.PLAYER_LEFT,
        payload: { playerId },
      } as InternalAction<S>);

      configRef.current.onPlayerLeft?.(playerId);

      // Start stale player cleanup timer
      const timeout =
        configRef.current.disconnectTimeout ?? DEFAULT_DISCONNECT_TIMEOUT;
      const timer = setTimeout(() => {
        cleanupTimers.current.delete(playerId);
        sessions.current.delete(secret);
        dispatch({
          type: InternalActionTypes.PLAYER_REMOVED,
          payload: { playerId },
        } as InternalAction<S>);
      }, timeout);
      cleanupTimers.current.set(playerId, timer);
    });

    server.on("error", (error) => {
      if (configRef.current.debug)
        console.error(`[GameHost] Server error:`, error);
      configRef.current.onError?.(error);
    });

    return () => {
      server.stop();
      for (const timer of cleanupTimers.current.values()) {
        clearTimeout(timer);
      }
      cleanupTimers.current.clear();
    };
  }, []); // Run once on mount

  // 3. Throttled State Broadcasts (~30fps)
  // Batches rapid state changes so at most one broadcast is sent per ~33ms frame,
  // reducing serialization overhead and network traffic for fast-updating games.
  const broadcastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const broadcastState = useCallback(() => {
    if (wsServer.current) {
      const actions = actionQueue.current;
      actionQueue.current = [];
      wsServer.current.broadcast({
        type: MessageTypes.STATE_UPDATE,
        payload: {
          newState: stateRef.current,
          timestamp: Date.now(),
          ...(actions.length === 1
            ? { action: actions[0] }
            : actions.length > 1
              ? { action: actions }
              : {}),
        },
      });
    }
  }, []);

  useEffect(() => {
    // Cancel any pending broadcast and schedule a fresh one.
    // This ensures the broadcast always uses the latest stateRef.
    if (broadcastTimer.current) {
      clearTimeout(broadcastTimer.current);
    }
    broadcastTimer.current = setTimeout(broadcastState, 33); // ~30fps

    return () => {
      if (broadcastTimer.current) {
        clearTimeout(broadcastTimer.current);
        broadcastTimer.current = null;
      }
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
