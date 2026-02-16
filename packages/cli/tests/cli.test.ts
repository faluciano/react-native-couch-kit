import { describe, expect, test, mock } from "bun:test";
import { Command } from "commander";

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
