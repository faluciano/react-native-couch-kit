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
  .action(async (options) => {
    const { bundleCommand } = await import("./commands/bundle");
    await bundleCommand.parseAsync(["bundle", ...reconstructArgs(options)], {
      from: "user",
    });
  });

program
  .command("simulate")
  .description("Spawns headless bots to simulate players")
  .option("-n, --count <number>", "Number of bots", "4")
  .option("-u, --url <url>", "WebSocket URL of host", "ws://localhost:8082")
  .option("-i, --interval <ms>", "Action interval in ms", "1000")
  .action(async (options) => {
    const { simulateCommand } = await import("./commands/simulate");
    await simulateCommand.parseAsync(
      ["simulate", ...reconstructArgs(options)],
      { from: "user" },
    );
  });

program
  .command("init")
  .description("Scaffolds a new web controller project")
  .argument("[name]", "Project name", "web-controller")
  .action(async (name) => {
    const { initCommand } = await import("./commands/init");
    await initCommand.parseAsync(["init", name], { from: "user" });
  });

/**
 * Reconstruct CLI args from parsed options for re-parsing by the lazy-loaded command.
 *
 * NOTE: Boolean options are assumed to use the negation pattern (--no-<x>).
 * Positive boolean flags (--verbose) will be silently dropped.
 * If adding positive boolean options, refactor to pass options directly instead.
 */
function reconstructArgs(options: Record<string, unknown>): string[] {
  const args: string[] = [];
  for (const [key, value] of Object.entries(options)) {
    if (typeof value === "boolean") {
      if (!value) args.push(`--no-${key}`);
    } else if (value !== undefined) {
      args.push(`--${key}`, String(value));
    }
  }
  return args;
}

program.parse();
