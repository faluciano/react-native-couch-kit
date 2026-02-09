import { describe, expect, test } from "bun:test";
import {
  createGameReducer,
  InternalActionTypes,
  type IAction,
  type IGameState,
  type InternalAction,
} from "../src/types";

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

  test("should handle user actions correctly", () => {
    const newState = reducer(initialState, { type: "INCREMENT" });
    expect(newState.count).toBe(1);
  });

  test("should not mutate original state", () => {
    const newState = reducer(initialState, { type: "INCREMENT" });
    expect(initialState.count).toBe(0);
    expect(newState).not.toBe(initialState);
  });

  test("should handle HYDRATE by replacing state wholesale", () => {
    const hydratedState: TestState = {
      status: "playing",
      players: {
        p1: { id: "p1", name: "Alice", isHost: false, connected: true },
      },
      count: 42,
    };
    const result = reducer(initialState, {
      type: InternalActionTypes.HYDRATE,
      payload: hydratedState,
    } as InternalAction<TestState>);
    expect(result).toEqual(hydratedState);
    expect(result).toBe(hydratedState); // should be the exact same reference
  });

  test("should handle PLAYER_JOINED by adding player to state", () => {
    const result = reducer(initialState, {
      type: InternalActionTypes.PLAYER_JOINED,
      payload: { id: "abc", name: "Bob", avatar: "🎮" },
    } as InternalAction<TestState>);
    expect(result.players["abc"]).toEqual({
      id: "abc",
      name: "Bob",
      avatar: "🎮",
      isHost: false,
      connected: true,
    });
    expect(result.count).toBe(0); // other state unchanged
  });

  test("PLAYER_JOINED should not overwrite existing players", () => {
    const stateWithPlayer: TestState = {
      ...initialState,
      players: {
        p1: { id: "p1", name: "Alice", isHost: true, connected: true },
      },
    };
    const result = reducer(stateWithPlayer, {
      type: InternalActionTypes.PLAYER_JOINED,
      payload: { id: "p2", name: "Charlie" },
    } as InternalAction<TestState>);
    expect(Object.keys(result.players)).toHaveLength(2);
    expect(result.players["p1"].name).toBe("Alice");
    expect(result.players["p2"].name).toBe("Charlie");
  });

  test("should handle PLAYER_LEFT by marking player as disconnected", () => {
    const stateWithPlayer: TestState = {
      ...initialState,
      players: {
        p1: { id: "p1", name: "Alice", isHost: false, connected: true },
      },
    };
    const result = reducer(stateWithPlayer, {
      type: InternalActionTypes.PLAYER_LEFT,
      payload: { playerId: "p1" },
    } as InternalAction<TestState>);
    expect(result.players["p1"].connected).toBe(false);
    expect(result.players["p1"].name).toBe("Alice"); // other fields preserved
  });

  test("PLAYER_LEFT for unknown player should return state unchanged", () => {
    const result = reducer(initialState, {
      type: InternalActionTypes.PLAYER_LEFT,
      payload: { playerId: "nonexistent" },
    } as InternalAction<TestState>);
    expect(result).toBe(initialState);
  });

  test("unknown action types should pass through to user reducer", () => {
    const result = reducer(initialState, { type: "DECREMENT" });
    expect(result.count).toBe(-1);
  });
});
