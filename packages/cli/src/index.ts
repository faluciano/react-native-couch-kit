#!/usr/bin/env node
import { Command } from "commander";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const program = new Command();

program.name("couch-kit").description("CLI for Couch Kit").version(version);

program
  .command("bundle")
  .description("Bundles the web controller into the Android assets directory")
  .option(
    "-s, --source <path>",
    "Source directory of web controller",
    "./web-controller",
  )
  .option(
    "-o, --output <path>",
    "Android assets directory",
    "./android/app/src/main/assets/www",
  )
  .option("--no-build", "Skip build step (just copy)")
  .option(
    "-m, --manifest <path>",
    "Also write manifest to this path for import in app source",
  )
  .action(async (_options, command) => {
    const { bundleCommand } = await import("./commands/bundle");
    await bundleCommand.parseAsync(reconstructArgs(command), {
      from: "user",
    });
  });

program
  .command("simulate")
  .description("Spawns headless bots to simulate players")
  .option("-n, --count <number>", "Number of bots", "4")
  .option("-u, --url <url>", "WebSocket URL of host", "ws://localhost:8082")
  .option("-i, --interval <ms>", "Action interval in ms", "1000")
  .action(async (_options, command) => {
    const { simulateCommand } = await import("./commands/simulate");
    await simulateCommand.parseAsync(reconstructArgs(command), {
      from: "user",
    });
  });

program
  .command("init")
  .description("Scaffolds a new web controller project")
  .argument("[name]", "Project name", "web-controller")
  .action(async (name) => {
    const { initCommand } = await import("./commands/init");
    await initCommand.parseAsync([name], { from: "user" });
  });

program
  .command("replay")
  .description("Replay a recorded game session against a reducer")
  .argument("<recording>", "Path to recording JSON file")
  .argument("<reducer>", "Path to reducer module")
  .option("--snapshots", "Output intermediate state snapshots")
  .option("--json", "Output as formatted JSON")
  .action(async (recording, reducer, _options, command) => {
    const { replay } = await import("./commands/replay");
    await replay.parseAsync([recording, reducer, ...reconstructArgs(command)], {
      from: "user",
    });
  });

program
  .command("dev")
  .description("Start development server with LAN access")
  .option("-p, --port <port>", "Port number", "5173")
  .option("--host", "Expose to LAN")
  .option("--open", "Open browser automatically")
  .action(async (_options, command) => {
    const { dev } = await import("./commands/dev");
    await dev.parseAsync(reconstructArgs(command), {
      from: "user",
    });
  });

/**
 * Reconstruct the CLI args for a lazily-loaded sub-command from the values
 * already parsed by its thin top-level proxy command.
 *
 * We reconstruct from each declared option's metadata (rather than
 * guessing flag names from the option values) so that every option kind is
 * forwarded with its correct flag:
 *   - value options (`--port 5173`)   -> `--port 5173`
 *   - positive booleans (`--open`)    -> emitted only when enabled
 *   - negated booleans (`--no-build`) -> emitted only when disabled
 *
 * Positional arguments are forwarded separately by each command's action.
 */
function reconstructArgs(command: Command): string[] {
  const args: string[] = [];
  const opts = command.opts();

  for (const option of command.options) {
    const value = opts[option.attributeName()];
    if (value === undefined) continue;

    if (option.negate) {
      // e.g. `--no-build` (attribute "build", defaults true): forward the
      // negated flag only when the user actually disabled it.
      if (value === false) args.push(option.long ?? option.short ?? "");
    } else if (option.isBoolean()) {
      // Positive flag such as `--host`/`--open`/`--snapshots`/`--json`:
      // forward it only when enabled.
      if (value === true) args.push(option.long ?? option.short ?? "");
    } else {
      // Value-bearing option such as `--port`/`--source`.
      args.push(option.long ?? option.short ?? "", String(value));
    }
  }

  return args;
}

program.parse();
