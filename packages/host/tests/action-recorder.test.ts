import { describe, expect, test } from "bun:test";
import { useActionRecorder } from "../src/action-recorder";
import type {
  ActionRecording,
  RecordedAction,
  ActionRecorderControls,
} from "../src/action-recorder";

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

    expect(_recording.actions).toHaveLength(0);
    expect(_recordedAction.action.type).toBe("TEST");
  });
});
