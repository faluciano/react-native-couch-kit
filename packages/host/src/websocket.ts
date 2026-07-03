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
import { generateId, DEFAULT_WS_PATH } from "@couch-kit/core";
import {
  DEFAULT_MAX_MESSAGE_BYTES,
  frameByteLength,
} from "./message-validation";

export interface WebSocketConfig {
  port: number;
  debug?: boolean;
  /**
   * Maximum size (in bytes) of an inbound client message. Frames larger than
   * this are discarded before parsing, bounding the memory a single client can
   * force the host to allocate. Defaults to {@link DEFAULT_MAX_MESSAGE_BYTES}
   * (256 KiB).
   */
  maxMessageBytes?: number;
  /**
   * @deprecated No effect. The underlying nitro-http WebSocket transport
   * manages frame sizing internally and this value is never read. This field
   * will be removed in a future major release. Do not set it.
   */
  maxFrameSize?: number;
  /**
   * @deprecated No effect. The nitro-http WebSocket transport does not expose
   * server-side keepalive ping configuration, so this value is never read.
   * Application-level heartbeats are handled by the host PING/PONG protocol.
   * This field will be removed in a future major release. Do not set it.
   */
  keepaliveInterval?: number;
  /**
   * @deprecated No effect. The nitro-http WebSocket transport does not expose
   * keepalive pong-timeout configuration, so this value is never read. This
   * field will be removed in a future major release. Do not set it.
   */
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
  private maxMessageBytes: number;

  constructor(config: WebSocketConfig) {
    super();
    this.port = config.port;
    this.debug = !!config.debug;
    this.maxMessageBytes =
      config.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
    // Only `port`, `debug`, and `maxMessageBytes` are honored. `maxFrameSize`,
    // `keepaliveInterval`, and `keepaliveTimeout` are deprecated no-ops: the
    // nitro-http WebSocket transport does not expose these knobs, so they are
    // intentionally ignored (see the @deprecated tags on WebSocketConfig).
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
      DEFAULT_WS_PATH,
      (ws: ServerWebSocket, request: WebSocketConnectionRequest) => {
        const socketId = generateId();
        this.log(`[WebSocket] New connection: ${socketId}`, request);

        // Store the client
        this.clients.set(socketId, { id: socketId, ws });

        // Emit connection event
        this.emit("connection", socketId);

        // Handle incoming messages
        ws.onmessage = (event: { data: string | ArrayBuffer }) => {
          // Reject oversized frames before parsing to bound memory usage.
          const size = frameByteLength(event.data);
          if (size > this.maxMessageBytes) {
            this.log(
              `[WebSocket] Message from ${socketId} exceeds limit ` +
                `(${size} > ${this.maxMessageBytes} bytes), discarding`,
            );
            return;
          }

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
              path: DEFAULT_WS_PATH,
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
