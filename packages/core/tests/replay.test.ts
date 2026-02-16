import { describe, expect, test } from "bun:test";
import type { IAction, IGameState, GameReducer } from "../src/types";
import { replayActions, type Recording } from "../src/replay";

interface TestState extends IGameState {
  count: number;
}

interface TestAction extends IAction {
  type: "INCREMENT" | "DECREMENT" | "SET";
  payload?: { value: number };
}

const testReducer: GameReducer<TestState, TestAction> = (state, action) => {
  switch (action.type) {
    case "INCREMENT":
      return { ...state, count: state.count + 1 };
    case "DECREMENT":
      return { ...state, count: state.count - 1 };
    case "SET":
      return { ...state, count: action.payload?.value ?? 0 };
    default:
      return state;
  }
};

const initialState: TestState = {
  status: "playing",
  players: {},
  count: 0,
};

describe("replayActions", () => {
  test("replays an empty recording", () => {
    const recording: Recording<TestState, TestAction> = {
      initialState,
      actions: [],
      startTimestamp: 1000,
    };

    const result = replayActions(recording, testReducer);

    expect(result.finalState).toEqual(initialState);
    expect(result.snapshots).toHaveLength(0);
    expect(result.actionCount).toBe(0);
    expect(result.duration).toBe(0);
  });

  test("replays a sequence of actions", () => {
    const recording: Recording<TestState, TestAction> = {
      initialState,
      actions: [
        { action: { type: "INCREMENT" }, timestamp: 1100 },
        { action: { type: "INCREMENT" }, timestamp: 1200 },
        { action: { type: "DECREMENT" }, timestamp: 1300 },
      ],
      startTimestamp: 1000,
    };

    const result = replayActions(recording, testReducer);

    expect(result.finalState.count).toBe(1);
    expect(result.snapshots).toHaveLength(3);
    expect(result.actionCount).toBe(3);
    expect(result.duration).toBe(300);
  });

  test("snapshots capture intermediate states", () => {
    const recording: Recording<TestState, TestAction> = {
      initialState,
      actions: [
        { action: { type: "INCREMENT" }, timestamp: 1100 },
        { action: { type: "SET", payload: { value: 10 } }, timestamp: 1200 },
        { action: { type: "DECREMENT" }, timestamp: 1300 },
      ],
      startTimestamp: 1000,
    };

    const result = replayActions(recording, testReducer);

    expect(result.snapshots[0].state.count).toBe(1);
    expect(result.snapshots[0].index).toBe(0);
    expect(result.snapshots[1].state.count).toBe(10);
    expect(result.snapshots[1].index).toBe(1);
    expect(result.snapshots[2].state.count).toBe(9);
    expect(result.snapshots[2].index).toBe(2);
  });

  test("uses endTimestamp for duration when provided", () => {
    const recording: Recording<TestState, TestAction> = {
      initialState,
      actions: [{ action: { type: "INCREMENT" }, timestamp: 1100 }],
      startTimestamp: 1000,
      endTimestamp: 2000,
    };

    const result = replayActions(recording, testReducer);

    expect(result.duration).toBe(1000);
  });

  test("preserves action metadata in snapshots", () => {
    const recording: Recording<TestState, TestAction> = {
      initialState,
      actions: [
        {
          action: { type: "INCREMENT", playerId: "p1", timestamp: 1100 },
          timestamp: 1100,
        },
      ],
      startTimestamp: 1000,
    };

    const result = replayActions(recording, testReducer);

    expect(result.snapshots[0].action.playerId).toBe("p1");
  });
});
