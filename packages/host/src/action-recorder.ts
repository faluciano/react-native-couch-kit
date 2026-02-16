import { useCallback, useRef, useState } from "react";
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
  /** Start recording actions. Captures current state as initial state. */
  startRecording: (currentState: S, metadata?: Record<string, unknown>) => void;
  /** Stop recording and return the recording */
  stopRecording: () => ActionRecording<S, A> | null;
  /** Record a single action (call this when dispatching) */
  recordAction: (action: A) => void;
  /** Export the current recording as JSON string */
  exportRecording: () => string | null;
  /** Discard the current recording */
  discardRecording: () => void;
}

/**
 * Hook that enables recording of game actions for later replay.
 * Used on the host side to capture game sessions.
 */
export function useActionRecorder<
  S extends IGameState = IGameState,
  A extends IAction = IAction,
>(): ActionRecorderControls<S, A> {
  const [isRecording, setIsRecording] = useState(false);
  const [recordedCount, setRecordedCount] = useState(0);
  const recordingRef = useRef<ActionRecording<S, A> | null>(null);

  const startRecording = useCallback(
    (currentState: S, metadata?: Record<string, unknown>) => {
      recordingRef.current = {
        initialState: currentState,
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
    if (!recordingRef.current) return;

    recordingRef.current.actions.push({
      action,
      timestamp: Date.now(),
    });
    setRecordedCount((c) => c + 1);
  }, []);

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
