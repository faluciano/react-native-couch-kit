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
});
