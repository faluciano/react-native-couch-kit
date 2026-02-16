import type { IGameState, IAction, InternalAction, GameReducer } from "./types";

// ---------------------------------------------------------------------------
// Middleware types
// ---------------------------------------------------------------------------

/** The API surface available to each middleware. */
export interface MiddlewareAPI<S extends IGameState> {
  getState: () => S;
}

/** A dispatch function that accepts user actions or internal actions. */
export type Dispatch<S extends IGameState, A extends IAction> = (
  action: A | InternalAction<S>,
) => S;

/**
 * Redux-style middleware — a three-layer curried function:
 *
 * 1. Receives the middleware API (`getState`).
 * 2. Receives `next` (the downstream dispatch).
 * 3. Receives the `action` and returns the new state.
 */
export type Middleware<
  S extends IGameState = IGameState,
  A extends IAction = IAction,
> = (
  api: MiddlewareAPI<S>,
) => (next: Dispatch<S, A>) => (action: A | InternalAction<S>) => S;

// ---------------------------------------------------------------------------
// applyMiddleware
// ---------------------------------------------------------------------------

/**
 * Composes an array of middlewares into a higher-order function that wraps a
 * game reducer.
 *
 * Middleware ordering follows the Redux convention: the **first** middleware in
 * the array is the outermost layer — it sees the action first on the way in and
 * last on the way out.
 *
 * Each middleware layer is wrapped in a try / catch. If a middleware throws, the
 * error is logged and the action falls through to the next layer so a single
 * broken middleware never tears down the entire dispatch chain.
 */
export function applyMiddleware<S extends IGameState, A extends IAction>(
  ...middlewares: Middleware<S, A>[]
): (
  reducer: GameReducer<S, A | InternalAction<S>>,
) => GameReducer<S, A | InternalAction<S>> {
  return (reducer: GameReducer<S, A | InternalAction<S>>) => {
    // Mutable ref so `getState()` always returns the latest state.
    let currentState: S;

    const api: MiddlewareAPI<S> = {
      getState: () => currentState,
    };

    // The innermost dispatch simply runs the actual reducer and updates the
    // mutable ref.
    const baseDispatch: Dispatch<S, A> = (action) => {
      currentState = reducer(currentState, action);
      return currentState;
    };

    // Build the chain by initialising each middleware with the API, then
    // composing right-to-left so the first middleware is outermost.
    const chain = middlewares.map((mw, index) => {
      const layer = mw(api);
      // Return a wrapper that adds an error boundary around each layer.
      return (next: Dispatch<S, A>): Dispatch<S, A> => {
        const handler = layer(next);
        return (action: A | InternalAction<S>): S => {
          try {
            return handler(action);
          } catch (error) {
            console.error(
              `[couch-kit] Middleware ${index} threw on action "${action.type}":`,
              error,
            );
            return next(action);
          }
        };
      };
    });

    // Compose right-to-left: last middleware wraps baseDispatch first.
    const dispatch = chain.reduceRight<Dispatch<S, A>>(
      (next, layer) => layer(next),
      baseDispatch,
    );

    // Return a reducer with the same signature that threads through the chain.
    return (state: S, action: A | InternalAction<S>): S => {
      currentState = state;
      return dispatch(action);
    };
  };
}

// ---------------------------------------------------------------------------
// actionLogger
// ---------------------------------------------------------------------------

/** Options for the built-in action logger middleware. */
export interface ActionLoggerOptions {
  /** Use `console.groupCollapsed` instead of `console.group`. Defaults to `true`. */
  collapsed?: boolean;
}

/**
 * Middleware that logs every dispatched action together with the previous and
 * next state.
 *
 * ```ts
 * createGameReducer(reducer, { middleware: [actionLogger()] });
 * ```
 */
export function actionLogger<S extends IGameState, A extends IAction>(
  options?: ActionLoggerOptions,
): Middleware<S, A> {
  const collapsed = options?.collapsed ?? true;

  return (api) => (next) => (action) => {
    const prevState = api.getState();
    const group = collapsed ? console.groupCollapsed : console.group;

    group(`[couch-kit] action ${action.type}`);
    console.log("prev state", prevState);
    console.log("action", action);

    const nextState = next(action);

    console.log("next state", nextState);
    console.groupEnd();

    return nextState;
  };
}

// ---------------------------------------------------------------------------
// actionValidator
// ---------------------------------------------------------------------------

/**
 * A map from action type strings to validator functions. Each validator receives
 * the fully-typed action and returns `true` if the action is valid.
 */
export type ActionSchema<A extends IAction> = {
  [K in A["type"]]?: (action: A & { type: K }) => boolean;
};

/**
 * Middleware that validates actions against a schema before they reach the
 * reducer. Invalid actions are silently dropped (with a console warning).
 *
 * Internal actions (types prefixed with `__`) are never validated — they always
 * pass through.
 *
 * ```ts
 * const validator = actionValidator<GameState, GameAction>({
 *   SCORE: (action) => action.payload > 0,
 * });
 * ```
 */
export function actionValidator<S extends IGameState, A extends IAction>(
  schema: ActionSchema<A>,
): Middleware<S, A> {
  return (api) => (next) => (action) => {
    // Internal actions always pass through — never validate them.
    if (action.type.startsWith("__")) return next(action);

    const validate = schema[action.type as A["type"]];

    if (validate && !validate(action as A & { type: A["type"] })) {
      console.warn(
        `[couch-kit] Action "${action.type}" failed validation, skipping`,
      );
      return api.getState();
    }

    return next(action);
  };
}
