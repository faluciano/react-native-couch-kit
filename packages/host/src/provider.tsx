import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  DEFAULT_HTTP_PORT,
  DEFAULT_WS_PORT_OFFSET,
  type IAction,
  type IGameState,
} from "@couch-kit/core";
import {
  GameHostRuntime,
  type GameHostRuntimeConfig,
} from "@couch-kit/runtime";
import { useStaticServer } from "./server";
import { GameWebSocketServer } from "./websocket";

export interface GameHostConfig<
  S extends IGameState,
  A extends IAction,
> extends GameHostRuntimeConfig<S, A> {
  port?: number;
  wsPort?: number;
  devMode?: boolean;
  devServerUrl?: string;
  staticDir?: string;
  /**
   * Maximum size of an inbound client message before parsing.
   * Defaults to 256 KiB.
   */
  maxMessageBytes?: number;
}

interface GameHostContextValue<S extends IGameState, A extends IAction> {
  state: S;
  dispatch: (action: A) => void;
  serverUrl: string | null;
  serverError: Error | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GameHostContext = createContext<GameHostContextValue<any, any> | null>(
  null,
);

/**
 * React Native adapter for the transport-neutral authoritative game runtime.
 *
 * The runtime owns canonical state and protocol behavior. This provider starts
 * the native static/WebSocket servers and exposes runtime state through React.
 */
export function GameHostProvider<S extends IGameState, A extends IAction>({
  children,
  config,
}: {
  children: React.ReactNode;
  config: GameHostConfig<S, A>;
}) {
  const runtimeRef = useRef<GameHostRuntime<S, A> | null>(null);
  if (!runtimeRef.current) {
    runtimeRef.current = new GameHostRuntime(config);
  }
  const runtime = runtimeRef.current;

  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
    runtime.updateConfig(config);
  }, [config, runtime]);

  const state = useSyncExternalStore(
    runtime.subscribe,
    runtime.getState,
    runtime.getState,
  );

  const httpPort = config.port || DEFAULT_HTTP_PORT;
  const { url: serverUrl, error: serverError } = useStaticServer({
    port: httpPort,
    devMode: config.devMode,
    devServerUrl: config.devServerUrl,
    staticDir: config.staticDir,
  });

  const shutdownRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    const port = config.wsPort || httpPort + DEFAULT_WS_PORT_OFFSET;
    const server = new GameWebSocketServer({
      port,
      debug: config.debug,
      maxMessageBytes: config.maxMessageBytes,
    });

    server.on("listening", (listeningPort) => {
      if (!active) return;
      if (configRef.current.debug) {
        console.log(`[GameHost] WebSocket listening on port ${listeningPort}`);
      }
    });

    server.on("connection", (connectionId) => {
      if (!active) return;
      runtime.handleConnection(connectionId);
    });

    server.on("message", (connectionId, rawMessage) => {
      if (!active) return;
      void runtime
        .handleMessage(connectionId, rawMessage)
        .catch((error: unknown) => {
          runtime.handleError(
            error instanceof Error ? error : new Error(String(error)),
          );
        });
    });

    server.on("disconnect", (connectionId) => {
      if (!active) return;
      runtime.handleDisconnect(connectionId);
    });

    server.on("error", (error) => {
      if (!active) return;
      runtime.handleError(error);
    });

    const startPromise = shutdownRef.current
      .then(async () => {
        if (!active) return;

        runtime.setTransport({
          send: (connectionId, message) => {
            server.send(connectionId, message);
          },
          broadcast: (message) => {
            server.broadcast(message);
          },
        });

        await server.start();
      })
      .catch((error: unknown) => {
        if (!active) return;
        runtime.handleError(
          error instanceof Error ? error : new Error(String(error)),
        );
      });

    return () => {
      active = false;
      runtime.setTransport(null);
      runtime.stop();
      shutdownRef.current = startPromise
        .then(() => server.stop())
        .catch((error: unknown) => {
          if (configRef.current.debug) {
            console.error("[GameHost] Failed to stop WebSocket server:", error);
          }
        });
    };
  }, []);

  const dispatch = useCallback(
    (action: A) => {
      runtime.dispatch(action);
    },
    [runtime],
  );

  const contextValue = useMemo(
    () => ({ state, dispatch, serverUrl, serverError }),
    [state, dispatch, serverUrl, serverError],
  );

  return (
    <GameHostContext.Provider value={contextValue}>
      {children}
    </GameHostContext.Provider>
  );
}

/**
 * Accesses canonical host state, trusted dispatch, and controller server URL.
 */
export function useGameHost<S extends IGameState, A extends IAction>() {
  const context = useContext(GameHostContext);
  if (!context) {
    throw new Error("useGameHost must be used within a GameHostProvider");
  }
  return context as GameHostContextValue<S, A>;
}
