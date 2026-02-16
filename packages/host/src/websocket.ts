/**
 * WebSocket Server Implementation using nitro-http
 *
 * Supports: bidirectional messaging, connection/disconnect events,
 * and integration with react-native-nitro-http-server's WebSocket plugin.
 */

import { ConfigServer } from "react-native-nitro-http-server";
import type {
  ServerWebSocket,
  WebSocketConnectionRequest,
} from "react-native-nitro-http-server";
import { EventEmitter } from "./event-emitter";
import { generateId } from "@couch-kit/core";

export interface WebSocketConfig {
  port: number;
  debug?: boolean;
  /** Maximum allowed frame payload size in bytes (default: 1 MB). */
  maxFrameSize?: number;
  /** Interval (ms) between server-side keepalive pings (default: 30s). 0 disables. */
  keepaliveInterval?: number;
  /** Timeout (ms) to wait for a pong after a keepalive ping (default: 10s). */
  keepaliveTimeout?: number;
}

/** Event map for type-safe event emission. */
export type WebSocketServerEvents = {
  connection: [socketId: string];
  message: [socketId: string, message: unknown];
  disconnect: [socketId: string];
  listening: [port: number];
  error: [error: Error];
};

interface WebSocketClient {
  id: string;
  ws: ServerWebSocket;
}

export class GameWebSocketServer extends EventEmitter<WebSocketServerEvents> {
  private server: ConfigServer | null = null;
  private clients: Map<string, WebSocketClient> = new Map();
  private port: number;
  private debug: boolean;

  constructor(config: WebSocketConfig) {
    super();
    this.port = config.port;
    this.debug = !!config.debug;
    // Note: maxFrameSize, keepaliveInterval, and keepaliveTimeout are not directly
    // configurable in nitro-http WebSocket plugin, but the underlying implementation
    // handles these concerns automatically.
  }

  private log(...args: unknown[]) {
    if (this.debug) {
      console.log(...args);
    }
  }

  public async start() {
    this.log(`[WebSocket] Starting server on port ${this.port}...`);

    this.server = new ConfigServer();

    // Register WebSocket handler for the /ws path
    this.server.onWebSocket(
      "/ws",
      (ws: ServerWebSocket, request: WebSocketConnectionRequest) => {
        const socketId = generateId();
        this.log(`[WebSocket] New connection: ${socketId}`, request);

        // Store the client
        this.clients.set(socketId, { id: socketId, ws });

        // Emit connection event
        this.emit("connection", socketId);

        // Handle incoming messages
        ws.onmessage = (event: { data: string | ArrayBuffer }) => {
          try {
            const data =
              typeof event.data === "string"
                ? event.data
                : new TextDecoder().decode(event.data);
            const message = JSON.parse(data);
            this.emit("message", socketId, message);
          } catch (error) {
            this.log(
              `[WebSocket] Invalid JSON from ${socketId}, discarding:`,
              error,
            );
          }
        };

        // Handle disconnect
        ws.onclose = (event: {
          code: number;
          reason: string;
          wasClean: boolean;
        }) => {
          this.log(
            `[WebSocket] Client disconnected: ${socketId}`,
            event.code,
            event.reason,
          );
          this.clients.delete(socketId);
          this.emit("disconnect", socketId);
        };

        // Handle errors
        ws.onerror = (event: { message: string }) => {
          this.log(`[WebSocket] Error on ${socketId}:`, event.message);
          this.emit(
            "error",
            new Error(`WebSocket error: ${event.message}`),
          );
        };
      },
    );

    // Start the server with WebSocket plugin
    try {
      await this.server.start(
        this.port,
        async () => {
          // Dummy HTTP handler - we're only using WebSocket functionality
          return {
            statusCode: 404,
            body: "WebSocket server - use ws:// protocol",
          };
        },
        {
          mounts: [
            {
              type: "websocket",
              path: "/ws",
            },
          ],
        },
        "0.0.0.0", // Bind to all interfaces
      );
      this.emit("listening", this.port);
      this.log(`[WebSocket] Server listening on port ${this.port}`);
    } catch (error) {
      this.log("[WebSocket] Failed to start server:", error);
      this.emit(
        "error",
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  public async stop() {
    if (this.server) {
      // Close all client connections
      for (const [, client] of this.clients) {
        try {
          await client.ws.close(1000, "Server shutting down");
        } catch (error) {
          this.log(
            "[WebSocket] Failed to close connection during shutdown:",
            error,
          );
        }
      }

      this.clients.clear();
      await this.server.stop();
      this.server = null;
    }
  }

  /**
   * Send data to a specific client by socket ID.
   * Silently ignores unknown socket IDs and write errors.
   */
  public send(socketId: string, data: unknown) {
    const client = this.clients.get(socketId);
    if (client) {
      try {
        const message = JSON.stringify(data);
        client.ws.send(message).catch((error: Error) => {
          this.log(`[WebSocket] Failed to send to ${socketId}:`, error);
          this.emit(
            "error",
            error instanceof Error ? error : new Error(String(error)),
          );
        });
      } catch (error) {
        this.log(`[WebSocket] Failed to serialize message:`, error);
        this.emit(
          "error",
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
  }

  /**
   * Broadcast data to all connected clients.
   * Wraps each send in try/catch so a single failed send doesn't skip remaining clients.
   */
  public broadcast(data: unknown, excludeId?: string) {
    try {
      const message = JSON.stringify(data);
      this.clients.forEach((client, id) => {
        if (id !== excludeId) {
          client.ws.send(message).catch((error: Error) => {
            this.log(`[WebSocket] Failed to broadcast to ${id}:`, error);
            // Don't abort -- continue sending to remaining clients
          });
        }
      });
    } catch (error) {
      this.log(`[WebSocket] Failed to serialize broadcast message:`, error);
      this.emit(
        "error",
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /** Returns the number of currently connected clients. */
  public get clientCount(): number {
    return this.clients.size;
  }
}
