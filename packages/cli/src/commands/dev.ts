import { resolve } from "node:path";
import { networkInterfaces } from "node:os";
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

export const dev = new Command("dev")
  .description("Start development server with LAN access for mobile testing")
  .option("-p, --port <port>", "Port number", "5173")
  .option("--host", "Expose to LAN", true)
  .option("--open", "Open browser automatically", false)
  .action(async (options: { port: string; host: boolean; open: boolean }) => {
    try {
      const port = parseInt(options.port, 10);
      const cwd = process.cwd();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let vite: any;
      try {
        // Dynamic import — vite is a user-land dependency, not a CLI dependency
        const vitePkg = "vite";
        vite = await import(vitePkg);
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
        configFile: resolve(cwd, "vite.config.ts"),
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
