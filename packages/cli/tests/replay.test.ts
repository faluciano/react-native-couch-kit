import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

class ExitError extends Error {
  constructor(public code?: number) {
    super(`process.exit(${code})`);
  }
}

const RECORDING = {
  initialState: { status: "lobby", players: {}, count: 0 },
  actions: [
    { action: { type: "INC" }, timestamp: 1000 },
    { action: { type: "INC" }, timestamp: 2000 },
    { action: { type: "INC" }, timestamp: 3000 },
  ],
  startTimestamp: 500,
  endTimestamp: 3500,
};

const REDUCER_SOURCE = `export default function reducer(state, action) {
  switch (action.type) {
    case "INC":
      return { ...state, count: (state.count ?? 0) + 1 };
    default:
      return state;
  }
}
`;

describe("replay command", () => {
  let tmpDir: string;
  let logs: string[];
  let errors: string[];
  let restore: (() => void)[];
  let recordingPath: string;
  let reducerPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "couch-kit-replay-"));
    recordingPath = path.join(tmpDir, "recording.json");
    reducerPath = path.join(tmpDir, "reducer.mjs");
    fs.writeFileSync(recordingPath, JSON.stringify(RECORDING));
    fs.writeFileSync(reducerPath, REDUCER_SOURCE);

    logs = [];
    errors = [];
    const logSpy = spyOn(console, "log").mockImplementation(
      (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      },
    );
    const errSpy = spyOn(console, "error").mockImplementation(
      (...args: unknown[]) => {
        errors.push(args.map(String).join(" "));
      },
    );
    restore = [() => logSpy.mockRestore(), () => errSpy.mockRestore()];
  });

  afterEach(() => {
    restore.forEach((fn) => fn());
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Import the `replay` command and reset its option values to their defaults.
   * Commander retains parsed option values on the (singleton) command instance
   * between `parseAsync` calls; in a real CLI invocation each run is a fresh
   * process, so we emulate that isolation here.
   */
  async function loadReplay() {
    const { replay } = await import("../src/commands/replay");
    replay.setOptionValue("json", false);
    replay.setOptionValue("snapshots", false);
    return replay;
  }

  function mockExit() {
    const exitSpy = spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new ExitError(code);
    }) as never);
    restore.push(() => exitSpy.mockRestore());
  }

  test("--json prints a summary with the final state", async () => {
    const replay = await loadReplay();
    await replay.parseAsync([recordingPath, reducerPath, "--json"], {
      from: "user",
    });

    const output = JSON.parse(logs.join("\n"));
    expect(output.actionCount).toBe(3);
    expect(output.duration).toBe(3000);
    expect(output.finalState.count).toBe(3);
    // Without --snapshots the JSON summary omits the snapshot array.
    expect(output.snapshots).toBeUndefined();
  });

  test("--json --snapshots includes every intermediate snapshot", async () => {
    const replay = await loadReplay();
    await replay.parseAsync(
      [recordingPath, reducerPath, "--json", "--snapshots"],
      { from: "user" },
    );

    const output = JSON.parse(logs.join("\n"));
    expect(Array.isArray(output.snapshots)).toBe(true);
    expect(output.snapshots).toHaveLength(3);
    expect(output.snapshots[2].state.count).toBe(3);
  });

  test("human-readable output reports the action count", async () => {
    const replay = await loadReplay();
    await replay.parseAsync([recordingPath, reducerPath], {
      from: "user",
    });

    const text = logs.join("\n");
    expect(text).toContain("Replayed 3 actions in 3000ms");
    expect(text).toContain("Final state:");
  });

  test("accepts a reducer exported as a named 'reducer'", async () => {
    const namedReducer = path.join(tmpDir, "named.mjs");
    fs.writeFileSync(
      namedReducer,
      `export const reducer = (state, action) =>
        action.type === "INC"
          ? { ...state, count: (state.count ?? 0) + 1 }
          : state;
`,
    );

    const replay = await loadReplay();
    await replay.parseAsync([recordingPath, namedReducer, "--json"], {
      from: "user",
    });

    expect(JSON.parse(logs.join("\n")).finalState.count).toBe(3);
  });

  test("exits when the recording file is missing", async () => {
    mockExit();
    const replay = await loadReplay();

    let thrown: unknown;
    try {
      await replay.parseAsync([path.join(tmpDir, "nope.json"), reducerPath], {
        from: "user",
      });
    } catch (e) {
      thrown = e;
    }

    expect((thrown as ExitError).code).toBe(1);
    expect(errors.join("\n")).toContain("Recording file not found");
  });

  test("exits on an invalid recording format", async () => {
    fs.writeFileSync(recordingPath, JSON.stringify({ not: "a recording" }));
    mockExit();
    const replay = await loadReplay();

    let thrown: unknown;
    try {
      await replay.parseAsync([recordingPath, reducerPath], {
        from: "user",
      });
    } catch (e) {
      thrown = e;
    }

    expect((thrown as ExitError).code).toBe(1);
    expect(errors.join("\n")).toContain("Invalid recording format");
  });

  test("exits when the reducer module exports no function", async () => {
    const badReducer = path.join(tmpDir, "bad.mjs");
    fs.writeFileSync(badReducer, `export const notAReducer = 42;\n`);
    mockExit();
    const replay = await loadReplay();

    let thrown: unknown;
    try {
      await replay.parseAsync([recordingPath, badReducer], {
        from: "user",
      });
    } catch (e) {
      thrown = e;
    }

    expect((thrown as ExitError).code).toBe(1);
    expect(errors.join("\n")).toContain("must export");
  });
});
