import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { networkInterfaces } from "node:os";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { toErrorMessage } from "@couch-kit/core";

function getLanIp(): string | null {
  const interfaces = networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    const nets = interfaces[name];
    if (!nets) continue;

    for (const net of nets) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }

  return null;
}

/** The ESM entry a package's `exports["."]` (or `module`/`main`) points to. */
function importEntry(pkg: {
  exports?: unknown;
  module?: string;
  main?: string;
}): string {
  const root =
    typeof pkg.exports === "object" && pkg.exports !== null
      ? (pkg.exports as Record<string, unknown>)["."]
      : pkg.exports;
  const pick = (value: unknown): string | undefined => {
    if (typeof value === "string") return value;
    if (typeof value !== "object" || value === null) return undefined;
    const conditions = value as Record<string, unknown>;
    return pick(conditions.import) ?? pick(conditions.default);
  };
  return pick(root) ?? pkg.module ?? pkg.main ?? "index.js";
}

/**
 * The project's own Vite, found by walking up from `cwd` through
 * `node_modules`, as a module path to import. A bare `import("vite")` would
 * resolve from wherever the CLI is installed (bunx, npx, a global install), not
 * from the project being served.
 */
export function findProjectVite(cwd: string): string | null {
  for (let dir = cwd; ; dir = dirname(dir)) {
    const pkgPath = join(dir, "node_modules", "vite", "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      return join(dirname(pkgPath), importEntry(pkg));
    }
    if (dirname(dir) === dir) return null;
  }
}

export const dev = new Command("dev")
  .description("Start development server with LAN access for mobile testing")
  .option("-p, --port <port>", "Port number", "5173")
  .option("--no-host", "Listen on localhost only (default: expose to LAN)")
  .option("--open", "Open browser automatically", false)
  .action(async (options: { port: string; host: boolean; open: boolean }) => {
    try {
      const port = Number(options.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        console.error(`Error: Invalid port "${options.port}"`);
        process.exit(1);
      }
      const cwd = process.cwd();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let vite: any;
      try {
        // Vite is a dependency of the project, not of the CLI: load the
        // project's copy, falling back to one next to the CLI.
        const projectVite = findProjectVite(cwd);
        const specifier = projectVite
          ? pathToFileURL(projectVite).href
          : "vite";
        vite = await import(specifier);
      } catch {
        console.error("Error: Vite is not installed. Run: bun add -d vite");
        process.exit(1);
      }

      const lanIp = getLanIp();

      console.log("Starting Couch Kit dev server...\n");

      const server = await vite.createServer({
        root: cwd,
        server: {
          port,
          host: options.host ? "0.0.0.0" : "localhost",
          open: options.open,
        },
        // No configFile: Vite finds vite.config.{ts,js,mjs,...} itself.
      });

      await server.listen();

      console.log(`  Local:   http://localhost:${port}/`);

      if (lanIp) {
        console.log(`  LAN:     http://${lanIp}:${port}/`);
        console.log(`\n  Scan QR or open LAN URL on your mobile device`);
      }

      console.log("\n  Press Ctrl+C to stop\n");
    } catch (error) {
      console.error(`Error: ${toErrorMessage(error)}`);
      process.exit(1);
    }
  });
