import { describe, expect, test } from "bun:test";
import { createGameReducer, type IAction, type IGameState } from "../src/types";

interface TestState extends IGameState {
  count: number;
}

interface TestAction extends IAction {
  type: "INCREMENT" | "DECREMENT";
}

describe("createGameReducer", () => {
  const initialState: TestState = {
    status: "lobby",
    players: {},
    count: 0,
  };

  const reducer = createGameReducer<TestState, TestAction>((state, action) => {
    switch (action.type) {
      case "INCREMENT":
        return { ...state, count: state.count + 1 };
      case "DECREMENT":
        return { ...state, count: state.count - 1 };
      default:
        return state;
    }
  });

  test("should handle actions correctly", () => {
    const newState = reducer(initialState, { type: "INCREMENT" });
    expect(newState.count).toBe(1);
  });

  test("should not mutate original state", () => {
    const newState = reducer(initialState, { type: "INCREMENT" });
    expect(initialState.count).toBe(0);
    expect(newState).not.toBe(initialState);
  });
});
