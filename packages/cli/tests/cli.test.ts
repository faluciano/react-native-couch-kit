import { describe, expect, test, mock } from "bun:test";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";

// Mock the dependencies
mock.module("ora", () => {
  return {
    default: () => ({
      start: () => ({
        text: "",
        succeed: () => {},
        fail: () => {},
        warn: () => {},
      }),
    }),
  };
});

const PACKAGE_ROOT = path.resolve(import.meta.dir, "..");

/** Recursively collects every `.ts` file under `dir`. */
function collectSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(entryPath);
    return entry.name.endsWith(".ts") ? [entryPath] : [];
  });
}

/**
 * The CLI is built with `bun build --target node` and ships with a
 * `#!/usr/bin/env node` shebang, so it must run under plain Node.
 */
describe("Node compatibility", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf-8"),
  );

  test("package.json marks the ESM build output as a module", () => {
    // dist/index.js is ESM; without this Node warns (or fails on older
    // versions) when it has to guess the module format.
    expect(pkg.type).toBe("module");
    expect(pkg.bin["couch-kit"]).toBe("./dist/index.js");
  });

  test("package.json requires a Node with a global WebSocket", () => {
    // `simulate` uses the global WebSocket, which is stable from Node 22.
    expect(pkg.engines.node).toBe(">=22.0.0");
  });

  test("source never uses Bun-only APIs unguarded", () => {
    const files = collectSourceFiles(path.join(PACKAGE_ROOT, "src"));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = fs.readFileSync(file, "utf-8");
      const relative = path.relative(PACKAGE_ROOT, file);

      // `typeof Bun !== "undefined"` is a safe guard; `Bun.<member>` is not.
      expect(
        /\bBun\s*\./.test(source),
        `${relative} uses the Bun global, which does not exist under Node`,
      ).toBe(false);
      expect(
        /from\s+["']bun(?::[\w-]+)?["']/.test(source),
        `${relative} imports a bun: module, which does not exist under Node`,
      ).toBe(false);
    }
  });
});

describe("CLI Structure", () => {
  test("should be able to import bundle command", async () => {
    // Dynamic import to allow mocking to take effect if needed
    const { bundleCommand } = await import("../src/commands/bundle");
    expect(bundleCommand).toBeInstanceOf(Command);
    expect(bundleCommand.name()).toBe("bundle");
  });

  test("should be able to import init command", async () => {
    const { initCommand } = await import("../src/commands/init");
    expect(initCommand).toBeInstanceOf(Command);
    expect(initCommand.name()).toBe("init");
  });

  test("should be able to import simulate command", async () => {
    const { simulateCommand } = await import("../src/commands/simulate");
    expect(simulateCommand).toBeInstanceOf(Command);
    expect(simulateCommand.name()).toBe("simulate");
  });

  test("should be able to import replay command", async () => {
    const { replay } = await import("../src/commands/replay");
    expect(replay).toBeInstanceOf(Command);
    expect(replay.name()).toBe("replay");
  });

  test("should be able to import dev command", async () => {
    const { dev } = await import("../src/commands/dev");
    expect(dev).toBeInstanceOf(Command);
    expect(dev.name()).toBe("dev");
  });
});
