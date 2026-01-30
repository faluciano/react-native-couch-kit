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
                warn: () => {}
            })
        })
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
});
