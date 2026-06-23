import { applyMiddleware } from "./middleware";
import type { Middleware } from "./middleware";
import { InternalActionTypes } from "./types";
import type {
  IGameState,
  IAction,
  InternalAction,
  GameReducer,
} from "./types";

/** Options for `createGameReducer`. */
export interface CreateGameReducerOptions<
  S extends IGameState,
  A extends IAction,
> {
  /**
   * Optional middleware stack. Middlewares are applied in order — the first
   * middleware in the array is the outermost layer and sees every action first.
   *
   * Middleware can observe **and** transform both user actions and internal
   * actions. Custom middleware should avoid blocking internal actions (types
   * prefixed with `__`) to prevent breaking framework behaviour.
   */
  middleware?: Middleware<S, A>[];
}

/**
 * Wraps a user-provided reducer with automatic handling of internal actions:
 *
 * - `__HYDRATE__` -- Replaces state wholesale (used for server→client state sync).
 * - `__PLAYER_JOINED__` -- Adds a player to `state.players`.
 * - `__PLAYER_LEFT__` -- Marks a player as disconnected in `state.players`.
 * - `__PLAYER_RECONNECTED__` -- Restores a returning player's connection status, preserving all existing data.
 * - `__PLAYER_REMOVED__` -- Permanently removes a timed-out disconnected player from `state.players`.
 *
 * The wrapped reducer accepts both `A` (user actions) and `InternalAction<S>`.
 * User reducers only need to handle their own action types.
 *
 * When `options.middleware` is provided, the middleware stack wraps around the
 * entire reducer (including internal-action handling). Middleware can observe
 * all actions flowing through the reducer.
 */
export function createGameReducer<S extends IGameState, A extends IAction>(
  reducer: GameReducer<S, A>,
  options?: CreateGameReducerOptions<S, A>,
): GameReducer<S, A | InternalAction<S>> {
  const baseReducer: GameReducer<S, A | InternalAction<S>> = (
    state: S,
    action: A | InternalAction<S>,
  ): S => {
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

      case InternalActionTypes.PLAYER_RECONNECTED: {
        const { playerId } = (
          action as InternalAction<S> & { type: "__PLAYER_RECONNECTED__" }
        ).payload;
        const player = state.players[playerId];
        if (!player) return state;
        return {
          ...state,
          players: {
            ...state.players,
            [playerId]: { ...player, connected: true },
          },
        };
      }

      case InternalActionTypes.PLAYER_REMOVED: {
        const { playerId } = (
          action as InternalAction<S> & { type: "__PLAYER_REMOVED__" }
        ).payload;
        if (!state.players[playerId]) return state;
        const { [playerId]: _, ...remainingPlayers } = state.players;
        return {
          ...state,
          players: remainingPlayers,
        };
      }

      default:
        return reducer(state, action as A);
    }
  };

  const middlewares = options?.middleware;

  if (!middlewares || middlewares.length === 0) return baseReducer;

  return applyMiddleware<S, A>(...middlewares)(baseReducer);
}
