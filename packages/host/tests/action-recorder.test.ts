import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useActionRecorder } from "../src/action-recorder";
import type {
  ActionRecording,
  RecordedAction,
  ActionRecorderControls,
} from "../src/action-recorder";

afterEach(cleanup);

describe("useActionRecorder", () => {
  test("is exported as a function", () => {
    expect(typeof useActionRecorder).toBe("function");
  });

  test("types are properly exported", () => {
    const _recording: ActionRecording = {
      initialState: { status: "playing", players: {} },
      actions: [],
      startTimestamp: Date.now(),
    };

    const _recordedAction: RecordedAction = {
      action: { type: "TEST" },
      timestamp: Date.now(),
    };

    const _controls: ActionRecorderControls = {
      isRecording: false,
      recordedCount: 0,
      startRecording: () => {},
      stopRecording: () => null,
      recordAction: () => {},
    };

    expect(_recording.actions).toHaveLength(0);
    expect(_recordedAction.action.type).toBe("TEST");
    expect(_controls.isRecording).toBe(false);
  });

  test("records, exports, stops, and discards an action sequence", () => {
    const state = {
      status: "playing",
      players: {},
      score: 2,
    };
    const { result } = renderHook(() =>
      useActionRecorder<typeof state, { type: string; payload?: number }>(),
    );

    act(() => {
      result.current.startRecording(state, { game: "buzz" });
    });
    expect(result.current.isRecording).toBe(true);
    expect(result.current.recordedCount).toBe(0);

    act(() => {
      result.current.recordAction({ type: "SCORE", payload: 3 });
    });
    expect(result.current.recordedCount).toBe(1);

    const exported = result.current.exportRecording();
    expect(exported).not.toBeNull();
    const parsed = JSON.parse(exported ?? "{}") as ActionRecording;
    expect(parsed.initialState).toEqual(state);
    expect(parsed.actions).toHaveLength(1);
    expect(parsed.actions[0].action).toEqual({
      type: "SCORE",
      payload: 3,
    });
    expect(parsed.metadata).toEqual({ game: "buzz" });

    let stopped: ActionRecording | null = null;
    act(() => {
      stopped = result.current.stopRecording();
    });
    expect(stopped?.endTimestamp).toBeNumber();
    expect(result.current.isRecording).toBe(false);

    act(() => {
      result.current.discardRecording();
    });
    expect(result.current.recordedCount).toBe(0);
    expect(result.current.exportRecording()).toBeNull();
    expect(result.current.stopRecording()).toBeNull();
  });

  test("with a source, records every action the host reduces", async () => {
    const { GameHostRuntime } = await import("@couch-kit/runtime");
    const { MessageTypes, generateId, replayActions } =
      await import("@couch-kit/core");
    type State = {
      status: string;
      players: Record<string, never>;
      score: number;
    };
    type Action = { type: "SCORE"; payload: number; playerId?: string };
    const reducer = (state: State, action: Action): State =>
      action.type === "SCORE"
        ? { ...state, score: state.score + action.payload }
        : state;
    const initialState: State = { status: "playing", players: {}, score: 0 };
    const runtime = new GameHostRuntime<State, Action>(
      { initialState, reducer, stateThrottleMs: 0 },
      { send: () => {}, broadcast: () => {} },
    );

    const { result } = renderHook(() =>
      useActionRecorder<State, Action>({ source: runtime }),
    );
    act(() => {
      result.current.startRecording();
    });

    // A phone joins and acts: neither passes through the host's dispatch,
    // which is all a recorder could see before.
    runtime.handleConnection("phone");
    await act(async () => {
      await runtime.handleMessage("phone", {
        type: MessageTypes.JOIN,
        payload: { name: "Ana", secret: generateId() },
      });
      await runtime.handleMessage("phone", {
        type: MessageTypes.ACTION,
        payload: { type: "SCORE", payload: 2 },
      });
    });
    act(() => {
      runtime.dispatch({ type: "SCORE", payload: 1 });
    });

    let recording: ActionRecording<State, Action> | null = null;
    act(() => {
      recording = result.current.stopRecording();
    });
    // Nothing after stop is recorded.
    act(() => {
      runtime.dispatch({ type: "SCORE", payload: 100 });
    });

    expect(recording!.initialState).toEqual(initialState);
    expect(recording!.actions.map(({ action }) => action.type)).toEqual([
      "__PLAYER_JOINED__",
      "SCORE",
      "SCORE",
    ]);
    // The recording replays to the state the host had when it stopped.
    expect(replayActions(recording!, reducer).finalState.score).toBe(3);
    runtime.stop();
  });

  test("without a source, startRecording needs a state", () => {
    const { result } = renderHook(() => useActionRecorder());
    expect(() => result.current.startRecording()).toThrow();
  });
});
