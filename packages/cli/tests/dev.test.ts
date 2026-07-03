import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";

class ExitError extends Error {
  constructor(public code?: number) {
    super(`process.exit(${code})`);
  }
}

/**
 * The CLI package deliberately does NOT depend on vite (it is a user-land
 * dependency of the scaffolded project). So in this test environment
 * `import("vite")` fails and the command must surface a helpful message and
 * exit rather than crash — that is the branch exercised here.
 */
describe("dev command", () => {
  let errors: string[];
  let restore: (() => void)[];

  beforeEach(() => {
    errors = [];
    const errSpy = spyOn(console, "error").mockImplementation(
      (...args: unknown[]) => {
        errors.push(args.map(String).join(" "));
      },
    );
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new ExitError(code);
    }) as never);
    restore = [
      () => errSpy.mockRestore(),
      () => logSpy.mockRestore(),
      () => exitSpy.mockRestore(),
    ];
  });

  afterEach(() => {
    restore.forEach((fn) => fn());
  });

  test("exits with a helpful message when vite is not installed", async () => {
    const { dev } = await import("../src/commands/dev");

    let thrown: unknown;
    try {
      await dev.parseAsync(["dev"], { from: "user" });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect((thrown as ExitError).code).toBe(1);
    expect(errors.join("\n")).toContain("Vite is not installed");
  });
});
