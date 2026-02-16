import { Command } from "commander";
import { MessageTypes, generateId } from "@couch-kit/core";

export const simulateCommand = new Command("simulate")
  .description("Spawns headless bots to simulate players")
  .option("-n, --count <number>", "Number of bots", "4")
  .option("-u, --url <url>", "WebSocket URL of host", "ws://localhost:8082")
  .option("-i, --interval <ms>", "Action interval in ms", "1000")
  .action(async (options) => {
    const count = parseInt(options.count);
    const url = options.url;
    const interval = parseInt(options.interval);

    console.log(`Spawning ${count} bots connecting to ${url}...`);

    const bots: WebSocket[] = [];
    const intervals: ReturnType<typeof setInterval>[] = [];

    for (let i = 0; i < count; i++) {
      const secret = generateId();
      const ws = new WebSocket(url);

      ws.addEventListener("open", () => {
        console.log(`[Bot ${i}] Connected`);

        // Join
        ws.send(
          JSON.stringify({
            type: MessageTypes.JOIN,
            payload: { name: `Bot ${i}`, avatar: "bot", secret },
          }),
        );

        // Random Actions Loop
        const id = setInterval(
          () => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: MessageTypes.ACTION,
                  payload: { type: "RANDOM_ACTION", payload: Math.random() },
                }),
              );
            }
          },
          interval + Math.random() * 500,
        ); // Add jitter

        intervals.push(id);
      });

      ws.addEventListener("message", (event) => {
        try {
          const msg = JSON.parse(
            typeof event.data === "string" ? event.data : event.data.toString(),
          );
          if (msg.type === MessageTypes.WELCOME) {
            console.log(`[Bot ${i}] Joined as ${msg.payload.playerId}`);
          } else if (msg.type === MessageTypes.ERROR) {
            console.error(`[Bot ${i}] Server error: ${msg.payload.message}`);
          }
        } catch {
          // Ignore unparseable messages
        }
      });

      ws.addEventListener("close", () => {
        console.log(`[Bot ${i}] Disconnected`);
      });

      ws.addEventListener("error", (e) => {
        console.error(`[Bot ${i}] Error:`, e);
      });

      bots.push(ws);
      // Stagger connections slightly
      await new Promise((r) => setTimeout(r, 100));
    }

    // Keep process alive
    process.stdin.resume();

    process.on("SIGINT", () => {
      console.log("\nStopping bots...");
      intervals.forEach((id) => clearInterval(id));
      bots.forEach((b) => b.close());
      process.exit();
    });
  });
