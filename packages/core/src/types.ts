export interface IPlayer {
  id: string;
  name: string;
  avatar?: string;
  isHost: boolean;
  connected: boolean;
}

export interface IGameState {
  status: string;
  players: Record<string, IPlayer>;
}

export interface IAction {
  type: string;
  payload?: unknown;
  playerId?: string;
  timestamp?: number;
}

export type GameReducer<S extends IGameState, A extends IAction> = (
  state: S,
  action: A,
) => S;

export function createGameReducer<S extends IGameState, A extends IAction>(
  reducer: GameReducer<S, A>,
): GameReducer<S, A> {
  return (state, action) => {
    // 1. Automatic State Hydration
    // This action is dispatched by the Client when it receives a full state update
    if (action.type === "HYDRATE" && action.payload) {
      return action.payload as S;
    }

    // 2. Automatic Player Management (Optional Default Behavior)
    // We can handle JOIN/LEAVE here if we want to enforce a standard player model,
    // but for now, we'll let the user handle it or provide a utility.

    return reducer(state, action);
  };
}
