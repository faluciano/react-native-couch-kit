import { describe, expect, spyOn, test } from "bun:test";
import path from "node:path";
import {
  DEFAULT_HTTP_PORT,
  DEFAULT_WS_PORT_OFFSET,
  DEFAULT_WS_PATH,
  MessageTypes,
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

describe("simulate bots", () => {
  test("join, send actions, report host messages, and stop on SIGINT", async () => {
    const received: { type: string; payload: Record<string, unknown> }[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req, srv) {
        return srv.upgrade(req)
          ? undefined
          : new Response(null, { status: 400 });
      },
      websocket: {
        message(ws, raw) {
          const msg = JSON.parse(String(raw));
          received.push(msg);
          if (msg.type === MessageTypes.JOIN) {
            ws.send(
              JSON.stringify({
                type: MessageTypes.WELCOME,
                payload: { playerId: "bot-player" },
              }),
            );
            ws.send(
              JSON.stringify({
                type: MessageTypes.ERROR,
                payload: { code: "FORBIDDEN_ACTION", message: "nope" },
              }),
            );
            ws.send("not json");
          }
        },
      },
    });

    const logs: string[] = [];
    const errors: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.map(String).join(" "));
    });
    const errSpy = spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args.map(String).join(" "));
    });
    const resumeSpy = spyOn(process.stdin, "resume").mockImplementation(
      () => process.stdin,
    );
    let onSigint: (() => void) | undefined;
    const onSpy = spyOn(process, "on").mockImplementation(((
      event: string,
      handler: () => void,
    ) => {
      if (event === "SIGINT") onSigint = handler;
      return process;
    }) as typeof process.on);
    const exitSpy = spyOn(process, "exit").mockImplementation(
      (() => undefined) as typeof process.exit,
    );

    try {
      const { simulateCommand } = await import("../src/commands/simulate");
      await simulateCommand.parseAsync(
        [
          "--count",
          "1",
          "--interval",
          "0",
          "--url",
          `ws://localhost:${server.port}`,
        ],
        { from: "user" },
      );

      const deadline = Date.now() + 5_000;
      while (
        Date.now() < deadline &&
        !(
          received.some((m) => m.type === MessageTypes.ACTION) &&
          logs.some((l) => l.includes("Joined as bot-player"))
        )
      ) {
        await Bun.sleep(20);
      }

      const join = received.find((m) => m.type === MessageTypes.JOIN);
      expect(join?.payload).toMatchObject({ name: "Bot 0", avatar: "bot" });
      expect(typeof join?.payload.secret).toBe("string");
      expect(
        received.find((m) => m.type === MessageTypes.ACTION)?.payload,
      ).toMatchObject({ type: "RANDOM_ACTION" });
      expect(logs).toContain("[Bot 0] Connected");
      expect(logs).toContain("[Bot 0] Joined as bot-player");
      expect(errors).toContain("[Bot 0] Server error: nope");

      expect(onSigint).toBeDefined();
      onSigint?.();
      expect(exitSpy).toHaveBeenCalled();

      const closeDeadline = Date.now() + 5_000;
      while (
        Date.now() < closeDeadline &&
        !logs.includes("[Bot 0] Disconnected")
      ) {
        await Bun.sleep(20);
      }
      expect(logs).toContain("[Bot 0] Disconnected");
    } finally {
      for (const spy of [logSpy, errSpy, resumeSpy, onSpy, exitSpy]) {
        spy.mockRestore();
      }
      server.stop(true);
    }
  });

  test("logs socket errors when the host is unreachable", async () => {
    const errors: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const errSpy = spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args.map(String).join(" "));
    });
    const resumeSpy = spyOn(process.stdin, "resume").mockImplementation(
      () => process.stdin,
    );
    const onSpy = spyOn(process, "on").mockImplementation(
      (() => process) as typeof process.on,
    );

    // Reserve a port, then free it so nothing is listening there.
    const probe = Bun.serve({ port: 0, fetch: () => new Response() });
    const port = probe.port;
    probe.stop(true);

    try {
      const { simulateCommand } = await import("../src/commands/simulate");
      await simulateCommand.parseAsync(
        ["--count", "1", "--url", `ws://localhost:${port}`],
        { from: "user" },
      );

      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && errors.length === 0) {
        await Bun.sleep(20);
      }
      expect(errors.some((e) => e.startsWith("[Bot 0] Error:"))).toBe(true);
    } finally {
      for (const spy of [logSpy, errSpy, resumeSpy, onSpy]) spy.mockRestore();
    }
  });
});
