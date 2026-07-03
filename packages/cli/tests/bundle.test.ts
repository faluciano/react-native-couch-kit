import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

class ExitError extends Error {
  constructor(public code?: number) {
    super(`process.exit(${code})`);
  }
}

describe("bundle command error handling", () => {
  let tmpDir: string;
  let errors: string[];
  let restore: (() => void)[];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "couch-kit-bundle-err-"));
    errors = [];
    const errSpy = spyOn(console, "error").mockImplementation(
      (...args: unknown[]) => {
        errors.push(args.map(String).join(" "));
      },
    );
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new ExitError(code);
    }) as never);
    restore = [
      () => errSpy.mockRestore(),
      () => logSpy.mockRestore(),
      () => warnSpy.mockRestore(),
      () => exitSpy.mockRestore(),
    ];
  });

  afterEach(() => {
    restore.forEach((fn) => fn());
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("exits when there is no build output to bundle", async () => {
    // Source dir exists but has no dist/ directory.
    const sourceDir = path.join(tmpDir, "web-controller");
    fs.mkdirSync(sourceDir, { recursive: true });

    const { bundleCommand } = await import("../src/commands/bundle");

    let thrown: unknown;
    try {
      await bundleCommand.parseAsync(
        [
          "--source",
          sourceDir,
          "--output",
          path.join(tmpDir, "out"),
          "--no-build",
        ],
        { from: "user" },
      );
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect((thrown as ExitError).code).toBe(1);
    expect(errors.join("\n")).toContain("Build output not found");
  });
});
