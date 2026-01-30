// Client -> Host Messages
export type ClientMessage =
  | { type: 'JOIN'; payload: { name: string; avatar?: string; secret?: string } }
  | { type: 'ACTION'; payload: { type: string; payload?: any } }
  | { type: 'PING'; payload: { id: string; timestamp: number } }
  | { type: 'ASSETS_LOADED'; payload: true };

// Host -> Client Messages
export type HostMessage =
  | { type: 'WELCOME'; payload: { playerId: string; state: any; serverTime: number } }
  | { type: 'STATE_UPDATE'; payload: { action: any; newState: any; timestamp: number } }
  | { type: 'PONG'; payload: { id: string; origTimestamp: number; serverTime: number } }
  | { type: 'RECONNECTED'; payload: { state: any } }
  | { type: 'ERROR'; payload: { code: string; message: string } };

export const MessageTypes = {
  // Client -> Host
  JOIN: 'JOIN',
  ACTION: 'ACTION',
  PING: 'PING',
  ASSETS_LOADED: 'ASSETS_LOADED',
  
  // Host -> Client
  WELCOME: 'WELCOME',
  STATE_UPDATE: 'STATE_UPDATE',
  PONG: 'PONG',
  RECONNECTED: 'RECONNECTED',
  ERROR: 'ERROR',
} as const;
