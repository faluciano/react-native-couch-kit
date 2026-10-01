import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  DEFAULT_HTTP_PORT,
  DEFAULT_WS_PORT_OFFSET,
  DEFAULT_WS_PATH,
} from "@couch-kit/core";
import { DEFAULT_SIMULATE_URL } from "../src/defaults";

const CLI_ENTRY = path.resolve(import.meta.dir, "../src/index.ts");

/**
 * Run the real CLI entry point in a child process. `index.ts` parses
 * `process.argv` on import, so it cannot be exercised in-process; spawning it
 * also covers the top-level proxy command -> lazily-loaded sub-command hop,
 * which is where the default URL used to get overridden.
 *
 * stdin is closed so `simulate` (which keeps itself alive via
 * `process.stdin.resume()`) exits as soon as its bots are spawned.
 */
function runCli(args: string[]) {
  const result = Bun.spawnSync([process.execPath, CLI_ENTRY, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15_000,
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("simulate default URL", () => {
  test("is built from the core constants and targets the /ws path", () => {
    expect(DEFAULT_SIMULATE_URL).toBe(
      `ws://localhost:${DEFAULT_HTTP_PORT + DEFAULT_WS_PORT_OFFSET}${DEFAULT_WS_PATH}`,
    );
    expect(DEFAULT_SIMULATE_URL.endsWith("/ws")).toBe(true);
  });

  test("sub-command uses the shared default", async () => {
    const { simulateCommand } = await import("../src/commands/simulate");
    const urlOption = simulateCommand.options.find((o) => o.long === "--url");

    expect(urlOption?.defaultValue).toBe(DEFAULT_SIMULATE_URL);
  });

  test("top-level proxy advertises the same default as the sub-command", () => {
    const { exitCode, stdout } = runCli(["simulate", "--help"]);
    expect(exitCode).toBe(0);

    // Commander may wrap the default onto its own line, so match across
    // whitespace rather than on a single line.
    const match = stdout.match(/--url <url>[\s\S]*?\(default:\s*"([^"]+)"\)/);
    expect(match?.[1]).toBe(DEFAULT_SIMULATE_URL);
    expect(match?.[1]?.endsWith("/ws")).toBe(true);
  });

  test("bots connect to the /ws default when --url is omitted", () => {
    // Zero bots: prints the resolved URL without opening any connection.
    const { exitCode, stdout } = runCli(["simulate", "--count", "0"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain(
      `Spawning 0 bots connecting to ${DEFAULT_SIMULATE_URL}...`,
    );
  });

  test("an explicit --url is forwarded through the proxy", () => {
    const { exitCode, stdout } = runCli([
      "simulate",
      "--count",
      "0",
      "--url",
      "ws://192.168.1.99:9000/ws",
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain(
      "Spawning 0 bots connecting to ws://192.168.1.99:9000/ws...",
    );
  });
});
