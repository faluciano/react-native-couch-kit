import { useCallback, useEffect, useRef, useState } from "react";
import type { IAction, IGameState } from "@couch-kit/core";

/**
 * A recorded action with timing metadata.
 */
export interface RecordedAction<A extends IAction = IAction> {
  action: A;
  timestamp: number;
}

/**
 * A complete recording of a game session.
 */
export interface ActionRecording<
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
 * Return type of useActionRecorder.
 */
export interface ActionRecorderControls<
  S extends IGameState = IGameState,
  A extends IAction = IAction,
> {
  /** Whether recording is currently active */
  isRecording: boolean;
  /** Number of actions recorded so far */
  recordedCount: number;
  /**
   * Start recording actions, capturing `currentState` as the initial state.
   * With a {@link ActionRecorderOptions.source}, `currentState` may be omitted
   * and the source's current state is used.
   */
  startRecording: (
    currentState?: S,
    metadata?: Record<string, unknown>,
  ) => void;
  /** Stop recording and return the recording */
  stopRecording: () => ActionRecording<S, A> | null;
  /**
   * Record a single action. Only needed without a
   * {@link ActionRecorderOptions.source}, which records every action itself.
   */
  recordAction: (action: A) => void;
  /** Export the current recording as JSON string */
  exportRecording: () => string | null;
  /** Discard the current recording */
  discardRecording: () => void;
}

/**
 * Where a recorder reads actions from on its own. `useGameHost()` returns one.
 */
export interface ActionRecorderSource<S extends IGameState = IGameState> {
  getState: () => S;
  subscribeActions: (listener: (action: IAction) => void) => () => void;
}

export interface ActionRecorderOptions<S extends IGameState = IGameState> {
  /**
   * Records every action the host reduces — including players' actions and
   * join/leave lifecycle actions, which never pass through the host's own
   * `dispatch`. Without it, only actions passed to `recordAction` are
   * recorded, which on a host means only the host's own dispatches.
   *
   * Recordings made this way contain internal actions (`__PLAYER_JOINED__`
   * and friends); `replayActions` handles them.
   *
   * @example
   * const host = useGameHost<GameState, GameAction>();
   * const recorder = useActionRecorder({ source: host });
   * recorder.startRecording();
   */
  source?: ActionRecorderSource<S>;
}

/**
 * Hook that enables recording of game actions for later replay.
 * Used on the host side to capture game sessions.
 */
export function useActionRecorder<
  S extends IGameState = IGameState,
  A extends IAction = IAction,
>(options: ActionRecorderOptions<S> = {}): ActionRecorderControls<S, A> {
  const { source } = options;
  const [isRecording, setIsRecording] = useState(false);
  const [recordedCount, setRecordedCount] = useState(0);
  const recordingRef = useRef<ActionRecording<S, A> | null>(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  const startRecording = useCallback(
    (currentState?: S, metadata?: Record<string, unknown>) => {
      const initialState = currentState ?? sourceRef.current?.getState();
      if (initialState === undefined) {
        throw new Error(
          "startRecording needs the current state when no source is configured",
        );
      }
      recordingRef.current = {
        initialState,
        actions: [],
        startTimestamp: Date.now(),
        metadata,
      };
      setIsRecording(true);
      setRecordedCount(0);
    },
    [],
  );

  const stopRecording = useCallback((): ActionRecording<S, A> | null => {
    if (!recordingRef.current) return null;

    recordingRef.current.endTimestamp = Date.now();
    const recording = recordingRef.current;
    setIsRecording(false);
    return recording;
  }, []);

  const recordAction = useCallback((action: A) => {
    // A stopped recording keeps its actions but takes no new ones.
    if (
      !recordingRef.current ||
      recordingRef.current.endTimestamp !== undefined
    )
      return;

    recordingRef.current.actions.push({
      action,
      timestamp: Date.now(),
    });
    setRecordedCount((c) => c + 1);
  }, []);

  const subscribeActions = source?.subscribeActions;
  useEffect(() => {
    if (!subscribeActions) return;
    return subscribeActions((action) => recordAction(action as A));
  }, [subscribeActions, recordAction]);

  const exportRecording = useCallback((): string | null => {
    if (!recordingRef.current) return null;
    return JSON.stringify(recordingRef.current, null, 2);
  }, []);

  const discardRecording = useCallback(() => {
    recordingRef.current = null;
    setIsRecording(false);
    setRecordedCount(0);
  }, []);

  return {
    isRecording,
    recordedCount,
    startRecording,
    stopRecording,
    recordAction,
    exportRecording,
    discardRecording,
  };
}
