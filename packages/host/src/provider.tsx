import React, { createContext, useContext, useEffect, useReducer, useRef } from 'react';
import { GameWebSocketServer } from './websocket';
import { useStaticServer } from './server';
import { 
  createGameReducer, 
  MessageTypes, 
  type IGameState, 
  type IAction, 
  type ClientMessage 
} from '@party-kit/core';

interface GameHostConfig<S extends IGameState, A extends IAction> {
  initialState: S;
  reducer: (state: S, action: A) => S;
  port?: number; // Static server port (default 8080)
  wsPort?: number; // WebSocket port (default 8081)
  devMode?: boolean;
  devServerUrl?: string;
  debug?: boolean;
}

interface GameHostContextValue<S extends IGameState, A extends IAction> {
  state: S;
  dispatch: (action: A) => void;
  serverUrl: string | null;
  serverError: Error | null;
}

// Create Context with 'any' fallback because Context generics are tricky in React
const GameHostContext = createContext<GameHostContextValue<any, any> | null>(null);

export function GameHostProvider<S extends IGameState, A extends IAction>({ 
  children, 
  config 
}: { 
  children: React.ReactNode, 
  config: GameHostConfig<S, A> 
}) {
  const [state, dispatch] = useReducer(config.reducer, config.initialState);
  
  // 1. Start Static File Server (Port 8080)
  const { url: serverUrl, error: serverError } = useStaticServer({
    port: config.port || 8080,
    devMode: config.devMode,
    devServerUrl: config.devServerUrl,
  });

  // 2. Start WebSocket Server (Port 8081)
  const wsServer = useRef<GameWebSocketServer | null>(null);

  useEffect(() => {
    const port = config.wsPort || 8081;
    const server = new GameWebSocketServer({ port });
    
    server.start();
    wsServer.current = server;

    server.on('listening', (p) => {
      if (config.debug) console.log(`[GameHost] WebSocket listening on port ${p}`);
    });

    server.on('connection', (socketId) => {
      if (config.debug) console.log(`[GameHost] Client connected: ${socketId}`);
    });

    server.on('message', (socketId, message: ClientMessage) => {
      if (config.debug) console.log(`[GameHost] Msg from ${socketId}:`, message);

      switch (message.type) {
        case MessageTypes.JOIN:
          // Handle Join (create player in state)
          // For MVP, we'll just dispatch a generic JOIN action if the reducer supports it
          // In a real app, we'd wrap this dispatch with specific logic
          dispatch({ 
            type: 'PLAYER_JOINED', 
            payload: { id: socketId, ...message.payload } 
          } as unknown as A);
          
          // Send Welcome
          server.send(socketId, {
            type: MessageTypes.WELCOME,
            payload: {
              playerId: socketId,
              state: state, // Warning: capturing closure state here (might be stale)
              serverTime: Date.now()
            }
          });
          break;

        case MessageTypes.ACTION:
          dispatch(message.payload as A);
          // Broadcast update to all
          // (Note: In a real effect, we should listen to state changes and broadcast them,
          // instead of broadcasting here, to ensure Single Source of Truth)
          break;
      }
    });

    server.on('disconnect', (socketId) => {
      if (config.debug) console.log(`[GameHost] Client disconnected: ${socketId}`);
      dispatch({ 
        type: 'PLAYER_LEFT', 
        payload: { playerId: socketId } 
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
                timestamp: Date.now()
            }
        });
    }
  }, [state]);

  return (
    <GameHostContext.Provider value={{ state, dispatch, serverUrl, serverError }}>
      {children}
    </GameHostContext.Provider>
  );
}

export function useGameHost<S extends IGameState, A extends IAction>() {
  const context = useContext(GameHostContext);
  if (!context) {
    throw new Error('useGameHost must be used within a GameHostProvider');
  }
  return context as GameHostContextValue<S, A>;
}
