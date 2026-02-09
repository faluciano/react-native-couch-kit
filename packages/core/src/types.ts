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

/**
 * Internal actions managed automatically by `createGameReducer`.
 * These are dispatched by the framework -- consumers do not need to handle them.
 */
export type InternalAction<S extends IGameState = IGameState> =
  | { type: "__HYDRATE__"; payload: S }
  | {
      type: "__PLAYER_JOINED__";
      payload: { id: string; name: string; avatar?: string; secret?: string };
    }
  | { type: "__PLAYER_LEFT__"; payload: { playerId: string } };

/** Well-known internal action type strings. */
export const InternalActionTypes = {
  HYDRATE: "__HYDRATE__",
  PLAYER_JOINED: "__PLAYER_JOINED__",
  PLAYER_LEFT: "__PLAYER_LEFT__",
} as const;

export type GameReducer<S extends IGameState, A extends IAction> = (
  state: S,
  action: A,
) => S;

/**
 * Wraps a user-provided reducer with automatic handling of internal actions:
 *
 * - `__HYDRATE__` -- Replaces state wholesale (used for server→client state sync).
 * - `__PLAYER_JOINED__` -- Adds a player to `state.players`.
 * - `__PLAYER_LEFT__` -- Marks a player as disconnected in `state.players`.
 *
 * The wrapped reducer accepts both `A` (user actions) and `InternalAction<S>`.
 * User reducers only need to handle their own action types.
 */
export function createGameReducer<S extends IGameState, A extends IAction>(
  reducer: GameReducer<S, A>,
): GameReducer<S, A | InternalAction<S>> {
  return (state: S, action: A | InternalAction<S>): S => {
    switch (action.type) {
      case InternalActionTypes.HYDRATE:
        return (action as InternalAction<S> & { type: "__HYDRATE__" }).payload;

      case InternalActionTypes.PLAYER_JOINED: {
        const { id, name, avatar } = (
          action as InternalAction<S> & { type: "__PLAYER_JOINED__" }
        ).payload;
        return {
          ...state,
          players: {
            ...state.players,
            [id]: {
              id,
              name,
              avatar,
              isHost: false,
              connected: true,
            },
          },
        };
      }

      case InternalActionTypes.PLAYER_LEFT: {
        const { playerId } = (
          action as InternalAction<S> & { type: "__PLAYER_LEFT__" }
        ).payload;
        const player = state.players[playerId];
        if (!player) return state;
        return {
          ...state,
          players: {
            ...state.players,
            [playerId]: { ...player, connected: false },
          },
        };
      }

      default:
        return reducer(state, action as A);
    }
  };
}
