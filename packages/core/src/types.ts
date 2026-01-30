export interface IPlayer {
  id: string;
  name: string;
  avatar?: string;
  isHost: boolean;
  connected: boolean;
}

export interface IGameState {
  status: 'lobby' | 'playing' | 'ended';
  players: Record<string, IPlayer>;
}

export interface IAction {
  type: string;
  payload?: any;
  playerId?: string;
  timestamp?: number;
}

export type GameReducer<S extends IGameState, A extends IAction> = (
  state: S,
  action: A
) => S;

export function createGameReducer<S extends IGameState, A extends IAction>(
  reducer: GameReducer<S, A>
): GameReducer<S, A> {
  return (state, action) => {
    // We can add middleware or logging here later
    return reducer(state, action);
  };
}
