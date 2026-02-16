import { describe, expect, test, mock, beforeEach } from "bun:test";
import {
  applyMiddleware,
  actionLogger,
  actionValidator,
  type Middleware,
  type MiddlewareAPI,
  type Dispatch,
  type ActionSchema,
} from "../src/middleware";
import {
  createGameReducer,
  InternalActionTypes,
  type IAction,
  type IGameState,
  type InternalAction,
  type GameReducer,
} from "../src/types";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

interface TestState extends IGameState {
  count: number;
}

type TestAction =
  | { type: "INCREMENT" }
  | { type: "DECREMENT" }
  | { type: "ADD"; payload: number };

const initialState: TestState = {
  status: "lobby",
  players: {},
  count: 0,
};

const testReducer: GameReducer<TestState, TestAction> = (state, action) => {
  switch (action.type) {
    case "INCREMENT":
      return { ...state, count: state.count + 1 };
    case "DECREMENT":
      return { ...state, count: state.count - 1 };
    case "ADD":
      return { ...state, count: state.count + (action.payload as number) };
    default:
      return state;
  }
};

// Wrap with internal-action handling (no middleware) for use in applyMiddleware tests.
const wrappedReducer = createGameReducer<TestState, TestAction>(testReducer);

// ---------------------------------------------------------------------------
// Middleware types
// ---------------------------------------------------------------------------

describe("middleware types", () => {
  test("middleware signature matches the three-layer curried shape", () => {
    const mw: Middleware<TestState, TestAction> =
      (_api: MiddlewareAPI<TestState>) =>
      (next: Dispatch<TestState, TestAction>) =>
      (action) =>
        next(action);

    // Should be callable through all three layers.
    const enhanced = applyMiddleware(mw)(wrappedReducer);
    const result = enhanced(initialState, { type: "INCREMENT" });
    expect(result.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Composition order
// ---------------------------------------------------------------------------

describe("composition order", () => {
  test("middlewares execute in declared order on the way in and reverse on return", () => {
    const order: string[] = [];

    const makeTracker =
      (label: string): Middleware<TestState, TestAction> =>
      (_api) =>
      (next) =>
      (action) => {
        order.push(`${label}-in`);
        const result = next(action);
        order.push(`${label}-out`);
        return result;
      };

    const enhanced = applyMiddleware<TestState, TestAction>(
      makeTracker("1"),
      makeTracker("2"),
      makeTracker("3"),
    )(wrappedReducer);

    enhanced(initialState, { type: "INCREMENT" });

    expect(order).toEqual(["1-in", "2-in", "3-in", "3-out", "2-out", "1-out"]);
  });
});

// ---------------------------------------------------------------------------
// Error boundary
// ---------------------------------------------------------------------------

describe("error boundary", () => {
  test("a throwing middleware is skipped and the action still reaches the reducer", () => {
    const errorSpy = mock(() => {});
    console.error = errorSpy;

    const badMiddleware: Middleware<TestState, TestAction> =
      (_api) => (_next) => (_action) => {
        throw new Error("boom");
      };

    const enhanced = applyMiddleware<TestState, TestAction>(badMiddleware)(
      wrappedReducer,
    );

    const result = enhanced(initialState, { type: "INCREMENT" });

    expect(result.count).toBe(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain("Middleware 0");
    expect(errorSpy.mock.calls[0][0]).toContain("INCREMENT");
  });

  test("error in one middleware does not affect others", () => {
    const errorSpy = mock(() => {});
    console.error = errorSpy;

    const order: string[] = [];

    const goodBefore: Middleware<TestState, TestAction> =
      (_api) => (next) => (action) => {
        order.push("before");
        return next(action);
      };

    const bad: Middleware<TestState, TestAction> =
      (_api) => (_next) => (_action) => {
        throw new Error("boom");
      };

    const goodAfter: Middleware<TestState, TestAction> =
      (_api) => (next) => (action) => {
        order.push("after");
        return next(action);
      };

    const enhanced = applyMiddleware<TestState, TestAction>(
      goodBefore,
      bad,
      goodAfter,
    )(wrappedReducer);

    const result = enhanced(initialState, { type: "INCREMENT" });

    // "before" runs, "bad" throws and is caught — the error boundary calls
    // next(action) which goes to "goodAfter", which calls next into the reducer.
    expect(result.count).toBe(1);
    expect(order).toContain("before");
    // "after" is called because the error boundary for `bad` calls next(action)
    // which flows into goodAfter.
    expect(order).toContain("after");
  });
});

// ---------------------------------------------------------------------------
// getState() returns latest
// ---------------------------------------------------------------------------

describe("getState() returns latest state", () => {
  test("getState reflects the state before the current dispatch", () => {
    let capturedState: TestState | undefined;

    const spy: Middleware<TestState, TestAction> =
      (api) => (next) => (action) => {
        capturedState = api.getState();
        return next(action);
      };

    const enhanced = applyMiddleware<TestState, TestAction>(spy)(
      wrappedReducer,
    );

    enhanced(initialState, { type: "INCREMENT" });
    expect(capturedState).toEqual(initialState);
  });

  test("getState in a later middleware sees state from the dispatch call", () => {
    const states: TestState[] = [];

    const capturer: Middleware<TestState, TestAction> =
      (api) => (next) => (action) => {
        states.push(api.getState());
        const result = next(action);
        states.push(api.getState());
        return result;
      };

    const enhanced = applyMiddleware<TestState, TestAction>(capturer)(
      wrappedReducer,
    );

    enhanced(initialState, { type: "INCREMENT" });

    // Before dispatch: state is still the initial state.
    expect(states[0]!.count).toBe(0);
    // After dispatch: getState reflects the new state.
    expect(states[1]!.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// actionLogger
// ---------------------------------------------------------------------------

describe("actionLogger", () => {
  let groupCollapsedSpy: ReturnType<typeof mock>;
  let groupSpy: ReturnType<typeof mock>;
  let logSpy: ReturnType<typeof mock>;
  let groupEndSpy: ReturnType<typeof mock>;

  beforeEach(() => {
    groupCollapsedSpy = mock(() => {});
    groupSpy = mock(() => {});
    logSpy = mock(() => {});
    groupEndSpy = mock(() => {});
    console.groupCollapsed = groupCollapsedSpy;
    console.group = groupSpy;
    console.log = logSpy;
    console.groupEnd = groupEndSpy;
  });

  test("uses console.groupCollapsed by default", () => {
    const enhanced = applyMiddleware<TestState, TestAction>(
      actionLogger<TestState, TestAction>(),
    )(wrappedReducer);

    enhanced(initialState, { type: "INCREMENT" });

    expect(groupCollapsedSpy).toHaveBeenCalledTimes(1);
    expect(groupSpy).not.toHaveBeenCalled();
    expect(groupEndSpy).toHaveBeenCalledTimes(1);
  });

  test("uses console.group when collapsed is false", () => {
    const enhanced = applyMiddleware<TestState, TestAction>(
      actionLogger<TestState, TestAction>({ collapsed: false }),
    )(wrappedReducer);

    enhanced(initialState, { type: "INCREMENT" });

    expect(groupSpy).toHaveBeenCalledTimes(1);
    expect(groupCollapsedSpy).not.toHaveBeenCalled();
    expect(groupEndSpy).toHaveBeenCalledTimes(1);
  });

  test("logs prev state, action, and next state", () => {
    const enhanced = applyMiddleware<TestState, TestAction>(
      actionLogger<TestState, TestAction>(),
    )(wrappedReducer);

    const action: TestAction = { type: "INCREMENT" };
    enhanced(initialState, action);

    // groupCollapsed label
    expect(groupCollapsedSpy.mock.calls[0][0]).toContain("INCREMENT");

    // console.log calls: prev state, action, next state
    expect(logSpy).toHaveBeenCalledTimes(3);
    expect(logSpy.mock.calls[0][0]).toBe("prev state");
    expect(logSpy.mock.calls[0][1]).toEqual(initialState);
    expect(logSpy.mock.calls[1][0]).toBe("action");
    expect(logSpy.mock.calls[1][1]).toEqual(action);
    expect(logSpy.mock.calls[2][0]).toBe("next state");
    expect(logSpy.mock.calls[2][1]).toEqual({ ...initialState, count: 1 });
  });
});

// ---------------------------------------------------------------------------
// actionValidator
// ---------------------------------------------------------------------------

describe("actionValidator", () => {
  let warnSpy: ReturnType<typeof mock>;

  beforeEach(() => {
    warnSpy = mock(() => {});
    console.warn = warnSpy;
  });

  test("valid action passes through to the reducer", () => {
    const schema: ActionSchema<TestAction> = {
      INCREMENT: () => true,
    };

    const enhanced = applyMiddleware<TestState, TestAction>(
      actionValidator<TestState, TestAction>(schema),
    )(wrappedReducer);

    const result = enhanced(initialState, { type: "INCREMENT" });
    expect(result.count).toBe(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("invalid action is skipped and returns current state", () => {
    const schema: ActionSchema<TestAction> = {
      INCREMENT: () => false,
    };

    const enhanced = applyMiddleware<TestState, TestAction>(
      actionValidator<TestState, TestAction>(schema),
    )(wrappedReducer);

    const result = enhanced(initialState, { type: "INCREMENT" });
    expect(result.count).toBe(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("INCREMENT");
    expect(warnSpy.mock.calls[0][0]).toContain("failed validation");
  });

  test("action with no matching validator passes through", () => {
    const schema: ActionSchema<TestAction> = {};

    const enhanced = applyMiddleware<TestState, TestAction>(
      actionValidator<TestState, TestAction>(schema),
    )(wrappedReducer);

    const result = enhanced(initialState, { type: "INCREMENT" });
    expect(result.count).toBe(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("internal actions always pass through regardless of schema", () => {
    // Even though we set up a catch-all-like schema, internal actions bypass.
    const schema: ActionSchema<TestAction> = {
      // Only user action types can be in the schema, but to verify internal
      // actions are not checked we can still test.
    };

    const enhanced = applyMiddleware<TestState, TestAction>(
      actionValidator<TestState, TestAction>(schema),
    )(wrappedReducer);

    const result = enhanced(initialState, {
      type: InternalActionTypes.PLAYER_JOINED,
      payload: { id: "p1", name: "Alice" },
    } as InternalAction<TestState>);

    expect(result.players["p1"]).toBeDefined();
    expect(result.players["p1"]!.name).toBe("Alice");
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Integration with createGameReducer
// ---------------------------------------------------------------------------

describe("integration with createGameReducer", () => {
  test("createGameReducer accepts middleware option and applies it", () => {
    const order: string[] = [];

    const tracker: Middleware<TestState, TestAction> =
      (_api) => (next) => (action) => {
        order.push(action.type);
        return next(action);
      };

    const reducer = createGameReducer<TestState, TestAction>(testReducer, {
      middleware: [tracker],
    });

    const result = reducer(initialState, { type: "INCREMENT" });
    expect(result.count).toBe(1);
    expect(order).toEqual(["INCREMENT"]);
  });

  test("middleware observes internal actions", () => {
    const observed: string[] = [];

    const observer: Middleware<TestState, TestAction> =
      (_api) => (next) => (action) => {
        observed.push(action.type);
        return next(action);
      };

    const reducer = createGameReducer<TestState, TestAction>(testReducer, {
      middleware: [observer],
    });

    reducer(initialState, {
      type: InternalActionTypes.PLAYER_JOINED,
      payload: { id: "p1", name: "Alice" },
    } as InternalAction<TestState>);

    expect(observed).toContain(InternalActionTypes.PLAYER_JOINED);
  });

  test("actionLogger works end-to-end with createGameReducer", () => {
    const groupCollapsedSpy = mock(() => {});
    const logSpy = mock(() => {});
    const groupEndSpy = mock(() => {});
    console.groupCollapsed = groupCollapsedSpy;
    console.log = logSpy;
    console.groupEnd = groupEndSpy;

    const reducer = createGameReducer<TestState, TestAction>(testReducer, {
      middleware: [actionLogger<TestState, TestAction>()],
    });

    const result = reducer(initialState, { type: "INCREMENT" });
    expect(result.count).toBe(1);
    expect(groupCollapsedSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledTimes(3);
    expect(groupEndSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// No middleware (backward compatibility)
// ---------------------------------------------------------------------------

describe("backward compatibility without middleware", () => {
  test("createGameReducer without options works identically", () => {
    const reducer = createGameReducer<TestState, TestAction>(testReducer);

    const result = reducer(initialState, { type: "INCREMENT" });
    expect(result.count).toBe(1);
  });

  test("createGameReducer with empty options works identically", () => {
    const reducer = createGameReducer<TestState, TestAction>(testReducer, {});

    const result = reducer(initialState, { type: "INCREMENT" });
    expect(result.count).toBe(1);
  });

  test("createGameReducer with empty middleware array works identically", () => {
    const reducer = createGameReducer<TestState, TestAction>(testReducer, {
      middleware: [],
    });

    const result = reducer(initialState, { type: "INCREMENT" });
    expect(result.count).toBe(1);
  });

  test("internal actions work without middleware", () => {
    const reducer = createGameReducer<TestState, TestAction>(testReducer);

    const result = reducer(initialState, {
      type: InternalActionTypes.PLAYER_JOINED,
      payload: { id: "p1", name: "Alice" },
    } as InternalAction<TestState>);

    expect(result.players["p1"]).toBeDefined();
    expect(result.players["p1"]!.name).toBe("Alice");
  });
});
