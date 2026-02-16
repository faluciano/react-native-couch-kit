import type { GameReducer, IAction, IGameState } from "./types";

/**
 * A recorded action with timing metadata.
 */
export interface RecordedAction<A extends IAction = IAction> {
  action: A;
  timestamp: number;
}

/**
 * A snapshot of state at a point in time during replay.
 */
export interface StateSnapshot<S extends IGameState = IGameState> {
  state: S;
  action: IAction;
  timestamp: number;
  index: number;
}

/**
 * A recording that can be replayed against a reducer.
 */
export interface Recording<
  S extends IGameState = IGameState,
  A extends IAction = IAction,
> {
  initialState: S;
  actions: RecordedAction<A>[];
  startTimestamp: number;
  endTimestamp?: number;
  metadata?: Record<string, unknown>;
}

/**
 * The result of replaying a recording.
 */
export interface ReplayResult<S extends IGameState = IGameState> {
  finalState: S;
  snapshots: StateSnapshot<S>[];
  duration: number;
  actionCount: number;
}

/**
 * Replays a recording against a reducer, producing the final state
 * and intermediate snapshots for each action applied.
 */
export function replayActions<
  S extends IGameState = IGameState,
  A extends IAction = IAction,
>(recording: Recording<S, A>, reducer: GameReducer<S, A>): ReplayResult<S> {
  const snapshots: StateSnapshot<S>[] = [];
  let currentState = recording.initialState;

  for (let i = 0; i < recording.actions.length; i++) {
    const { action, timestamp } = recording.actions[i];
    currentState = reducer(currentState, action);

    snapshots.push({
      state: currentState,
      action,
      timestamp,
      index: i,
    });
  }

  const endTimestamp =
    recording.endTimestamp ??
    (recording.actions.length > 0
      ? recording.actions[recording.actions.length - 1].timestamp
      : recording.startTimestamp);

  return {
    finalState: currentState,
    snapshots,
    duration: endTimestamp - recording.startTimestamp,
    actionCount: recording.actions.length,
  };
}
