/**
 * Lightweight WebSocket Server Implementation
 * Built on top of react-native-tcp-socket
 *
 * Supports: text frames, close frames, ping/pong, multi-frame TCP packets,
 * server-side keepalive, frame size limits, and robust buffer management per RFC 6455.
 */

import TcpSocket from "react-native-tcp-socket";
import type { TcpSocketInstance } from "./declarations";
import { EventEmitter } from "./event-emitter";
import { Buffer } from "buffer";
import { sha1 } from "js-sha1";
import {
  generateId,
  MAX_FRAME_SIZE,
  KEEPALIVE_INTERVAL,
  KEEPALIVE_TIMEOUT,
} from "@couch-kit/core";
import { appendToBuffer, compactBuffer } from "./buffer-utils";
import type { ManagedSocket } from "./buffer-utils";

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

// WebSocket opcodes (RFC 6455 Section 5.2)
const OPCODE = {
  CONTINUATION: 0x0,
  TEXT: 0x1,
  BINARY: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xa,
} as const;

// Simple WebSocket Frame Parser/Builder
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** Initial capacity for per-client receive buffers. */
const INITIAL_BUFFER_CAPACITY = 4096;

interface DecodedFrame {
  opcode: number;
  payload: Buffer;
  bytesConsumed: number;
}

export class GameWebSocketServer extends EventEmitter<WebSocketServerEvents> {
  private server: ReturnType<typeof TcpSocket.createServer> | null = null;
  private clients: Map<string, ManagedSocket> = new Map();
  private port: number;
  private debug: boolean;
  private maxFrameSize: number;
  private keepaliveInterval: number;
  private keepaliveTimeout: number;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: WebSocketConfig) {
    super();
    this.port = config.port;
    this.debug = !!config.debug;
    this.maxFrameSize = config.maxFrameSize ?? MAX_FRAME_SIZE;
    this.keepaliveInterval = config.keepaliveInterval ?? KEEPALIVE_INTERVAL;
    this.keepaliveTimeout = config.keepaliveTimeout ?? KEEPALIVE_TIMEOUT;
  }

  private log(...args: unknown[]) {
    if (this.debug) {
      console.log(...args);
    }
  }

  public start() {
    this.log(`[WebSocket] Starting server on port ${this.port}...`);

    this.server = TcpSocket.createServer((rawSocket: TcpSocketInstance) => {
      const addrInfo = rawSocket.address();
      const remoteAddr =
        addrInfo && "address" in addrInfo ? addrInfo.address : "unknown";
      this.log(`[WebSocket] New connection from ${remoteAddr}`);

      const managed: ManagedSocket = {
        socket: rawSocket,
        id: "",
        isHandshakeComplete: false,
        buffer: Buffer.alloc(INITIAL_BUFFER_CAPACITY),
        bufferLength: 0,
        lastPong: Date.now(),
      };

      rawSocket.on("data", (data: Buffer | string) => {
        this.log(
          `[WebSocket] Received data chunk: ${typeof data === "string" ? data.length : data.length} bytes`,
        );
        // Append new data using growing buffer strategy (avoids Buffer.concat per event)
        const incoming = typeof data === "string" ? Buffer.from(data) : data;
        appendToBuffer(managed, incoming);

        // Handshake not yet performed?
        if (!managed.isHandshakeComplete) {
          const header = managed.buffer.toString(
            "utf8",
            0,
            managed.bufferLength,
          );
          const endOfHeader = header.indexOf("\r\n\r\n");
          if (endOfHeader !== -1) {
            this.handleHandshake(managed, header);
            // Compact buffer past the handshake header
            const headerByteLength = Buffer.byteLength(
              header.substring(0, endOfHeader + 4),
              "utf8",
            );
            compactBuffer(managed, headerByteLength);
            managed.isHandshakeComplete = true;
            // Fall through to process any remaining frames below
          } else {
            return;
          }
        }

        // Process all complete frames in the buffer
        this.processFrames(managed);
      });

      rawSocket.on("error", (error: Error) => {
        this.emit("error", error);
      });

      rawSocket.on("close", () => {
        if (managed.id) {
          this.clients.delete(managed.id);
          this.emit("disconnect", managed.id);
        }
      });
    });

    // Handle server-level errors (e.g., port already in use)
    this.server.on("error", (error: Error) => {
      this.log("[WebSocket] Server error:", error);
      this.emit("error", error);
    });

    this.server.listen({ port: this.port, host: "0.0.0.0" }, () => {
      this.log(`[WebSocket] Server listening on 0.0.0.0:${this.port}`);
      this.emit("listening", this.port);
    });

    // Start keepalive pings if enabled
    if (this.keepaliveInterval > 0) {
      this.startKeepalive();
    }
  }

  private startKeepalive() {
    this.keepaliveTimer = setInterval(() => {
      const now = Date.now();
      const pingFrame = this.encodeControlFrame(OPCODE.PING, Buffer.alloc(0));

      for (const [id, managed] of this.clients) {
        // Check if previous keepalive timed out
        if (
          now - managed.lastPong >
          this.keepaliveInterval + this.keepaliveTimeout
        ) {
          this.log(`[WebSocket] Keepalive timeout for ${id}, disconnecting`);
          try {
            managed.socket.destroy();
          } catch (error) {
            this.log(
              "[WebSocket] Socket already destroyed during keepalive cleanup:",
              error,
            );
          }
          this.clients.delete(id);
          this.emit("disconnect", id);
          continue;
        }

        try {
          managed.socket.write(pingFrame);
        } catch (error) {
          this.log("[WebSocket] Failed to send keepalive ping:", error);
        }
      }
    }, this.keepaliveInterval);
  }

  private processFrames(managed: ManagedSocket) {
    let offset = 0;

    while (offset < managed.bufferLength) {
      // Create a view of the unconsumed portion for decoding
      const view = Buffer.from(
        managed.buffer.buffer,
        managed.buffer.byteOffset + offset,
        managed.bufferLength - offset,
      );
      let frame: DecodedFrame | null;
      try {
        frame = this.decodeFrame(view);
      } catch (error) {
        // Frame too large or malformed -- disconnect the client
        this.log(`[WebSocket] Frame error from ${managed.id}:`, error);
        try {
          managed.socket.destroy();
        } catch (destroyError) {
          this.log(
            "[WebSocket] Socket already destroyed after frame error:",
            destroyError,
          );
        }
        return;
      }

      if (!frame) {
        // Incomplete frame -- keep remaining bytes, wait for more data
        break;
      }

      // Advance past the consumed frame
      offset += frame.bytesConsumed;

      // Handle frame by opcode
      switch (frame.opcode) {
        case OPCODE.TEXT: {
          try {
            const message = JSON.parse(frame.payload.toString("utf8"));
            this.emit("message", managed.id, message);
          } catch (error) {
            // Corrupt JSON in a complete frame -- discard this frame, continue processing
            this.log(
              `[WebSocket] Invalid JSON from ${managed.id}, discarding frame:`,
              error,
            );
          }
          break;
        }

        case OPCODE.CLOSE: {
          this.log(`[WebSocket] Close frame from ${managed.id}`);
          // Send close frame back (RFC 6455 Section 5.5.1)
          const closeFrame = Buffer.alloc(2);
          closeFrame[0] = 0x88; // FIN + Close opcode
          closeFrame[1] = 0x00; // No payload
          try {
            managed.socket.write(closeFrame);
          } catch (error) {
            this.log("[WebSocket] Failed to send close frame:", error);
          }
          managed.socket.destroy();
          break;
        }

        case OPCODE.PING: {
          this.log(`[WebSocket] Ping from ${managed.id}`);
          // Respond with pong containing the same payload (RFC 6455 Section 5.5.3)
          const pongFrame = this.encodeControlFrame(OPCODE.PONG, frame.payload);
          try {
            managed.socket.write(pongFrame);
          } catch (error) {
            this.log("[WebSocket] Failed to send pong:", error);
          }
          break;
        }

        case OPCODE.PONG: {
          // Update last-seen pong time for keepalive tracking
          managed.lastPong = Date.now();
          this.log(`[WebSocket] Pong from ${managed.id}`);
          break;
        }

        case OPCODE.BINARY: {
          // Binary frames not supported -- log and discard
          this.log(
            `[WebSocket] Binary frame from ${managed.id}, not supported -- discarding`,
          );
          break;
        }

        default: {
          this.log(
            `[WebSocket] Unknown opcode 0x${frame.opcode.toString(16)} from ${managed.id}, discarding`,
          );
          break;
        }
      }

      // If socket was destroyed (e.g., close frame), stop processing
      if (managed.socket.destroyed) break;
    }

    // Compact buffer: shift unconsumed bytes to the front
    compactBuffer(managed, offset);
  }

  /**
   * Gracefully stop the server.
   * Sends close frames to all clients before destroying connections.
   */
  public stop() {
    // Stop keepalive timer
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }

    if (this.server) {
      // Send close frames to all clients before destroying
      const closeFrame = Buffer.alloc(2);
      closeFrame[0] = 0x88; // FIN + Close opcode
      closeFrame[1] = 0x00; // No payload

      this.clients.forEach((managed) => {
        try {
          managed.socket.write(closeFrame);
        } catch (error) {
          this.log(
            "[WebSocket] Failed to send close frame during shutdown:",
            error,
          );
        }
        try {
          managed.socket.destroy();
        } catch (error) {
          this.log(
            "[WebSocket] Socket already destroyed during shutdown:",
            error,
          );
        }
      });

      this.clients.clear();
      this.server.close();
    }
  }

  /**
   * Send data to a specific client by socket ID.
   * Silently ignores unknown socket IDs and write errors.
   */
  public send(socketId: string, data: unknown) {
    const managed = this.clients.get(socketId);
    if (managed) {
      try {
        const frame = this.encodeFrame(JSON.stringify(data));
        managed.socket.write(frame);
      } catch (error) {
        this.log(`[WebSocket] Failed to send to ${socketId}:`, error);
        this.emit(
          "error",
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
  }

  /**
   * Broadcast data to all connected clients.
   * Wraps each write in try/catch so a single dead socket doesn't skip remaining clients.
   */
  public broadcast(data: unknown, excludeId?: string) {
    const frame = this.encodeFrame(JSON.stringify(data));
    this.clients.forEach((managed, id) => {
      if (id !== excludeId) {
        try {
          managed.socket.write(frame);
        } catch (error) {
          this.log(`[WebSocket] Failed to broadcast to ${id}:`, error);
          // Don't abort -- continue sending to remaining clients
        }
      }
    });
  }

  /** Returns the number of currently connected clients. */
  public get clientCount(): number {
    return this.clients.size;
  }

  // --- Private Helpers ---

  private handleHandshake(managed: ManagedSocket, header: string) {
    this.log("[WebSocket] Handshake request header:", JSON.stringify(header));
    const keyMatch = header.match(/Sec-WebSocket-Key: (.+)/);
    if (!keyMatch) {
      console.error("[WebSocket] Handshake failed: No Sec-WebSocket-Key found");
      managed.socket.destroy();
      return;
    }

    // Validate Sec-WebSocket-Version (RFC 6455 Section 4.2.1)
    const versionMatch = header.match(/Sec-WebSocket-Version: (\d+)/);
    if (versionMatch && versionMatch[1] !== "13") {
      console.error(
        `[WebSocket] Unsupported WebSocket version: ${versionMatch[1]}`,
      );
      managed.socket.destroy();
      return;
    }

    const key = keyMatch[1].trim();
    this.log("[WebSocket] Client Key:", key);

    try {
      const acceptKey = this.generateAcceptKey(key);
      this.log("[WebSocket] Generated Accept Key:", acceptKey);

      const response = [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${acceptKey}`,
        "\r\n",
      ].join("\r\n");

      this.log(
        "[WebSocket] Sending Handshake Response:",
        JSON.stringify(response),
      );
      managed.socket.write(response);

      // Assign cryptographically random ID and store
      managed.id = generateId();
      this.clients.set(managed.id, managed);
      this.emit("connection", managed.id);
    } catch (error) {
      console.error("[WebSocket] Handshake error:", error);
      managed.socket.destroy();
    }
  }

  private generateAcceptKey(key: string): string {
    const input = key + GUID;
    const hash = sha1(input);
    this.log(`[WebSocket] SHA1 Input: ${input}`);
    this.log(`[WebSocket] SHA1 Hash (hex): ${hash}`);
    return Buffer.from(hash, "hex").toString("base64");
  }

  private decodeFrame(buffer: Buffer): DecodedFrame | null {
    // Need at least 2 bytes for the header
    if (buffer.length < 2) return null;

    const firstByte = buffer[0];
    const opcode = firstByte & 0x0f;

    const secondByte = buffer[1];
    const isMasked = (secondByte & 0x80) !== 0;
    let payloadLength = secondByte & 0x7f;
    let headerLength = 2;

    if (payloadLength === 126) {
      if (buffer.length < 4) return null; // Need 2 more bytes for extended length
      payloadLength = buffer.readUInt16BE(2);
      headerLength = 4;
    } else if (payloadLength === 127) {
      if (buffer.length < 10) return null; // Need 8 more bytes for extended length
      // Read 64-bit length. For safety, only use the lower 32 bits.
      const highBits = buffer.readUInt32BE(2);
      if (highBits > 0) {
        throw new Error("Frame payload too large (exceeds 4 GB)");
      }
      payloadLength = buffer.readUInt32BE(6);
      headerLength = 10;
    }

    // Enforce max frame size to prevent memory exhaustion attacks
    if (payloadLength > this.maxFrameSize) {
      throw new Error(
        `Frame payload (${payloadLength} bytes) exceeds maximum allowed size (${this.maxFrameSize} bytes)`,
      );
    }

    const maskLength = isMasked ? 4 : 0;
    const totalFrameLength = headerLength + maskLength + payloadLength;

    // Check if we have the complete frame
    if (buffer.length < totalFrameLength) return null;

    let payload: Buffer;
    if (isMasked) {
      const mask = buffer.subarray(headerLength, headerLength + 4);
      const maskedPayload = buffer.subarray(
        headerLength + 4,
        headerLength + 4 + payloadLength,
      );
      payload = Buffer.alloc(payloadLength);
      for (let i = 0; i < payloadLength; i++) {
        payload[i] = maskedPayload[i] ^ mask[i % 4];
      }
    } else {
      payload = Buffer.from(
        buffer.subarray(headerLength, headerLength + payloadLength),
      );
    }

    return { opcode, payload, bytesConsumed: totalFrameLength };
  }

  private encodeFrame(data: string): Buffer {
    // Server -> Client frames are NOT masked (text frame)
    return this.buildFrame(OPCODE.TEXT, Buffer.from(data));
  }

  private encodeControlFrame(opcode: number, payload: Buffer): Buffer {
    return this.buildFrame(opcode, payload);
  }

  private buildFrame(opcode: number, payload: Buffer): Buffer {
    let headerLength = 2;

    if (payload.length > 65535) {
      headerLength = 10; // 2 header + 8 length
    } else if (payload.length > 125) {
      headerLength = 4; // 2 header + 2 length
    }

    const frame = Buffer.alloc(headerLength + payload.length);
    frame[0] = 0x80 | opcode; // FIN bit set + opcode

    if (payload.length > 65535) {
      frame[1] = 127;
      // Write 64-bit integer (max safe integer in JS is 2^53, so high 32 bits are 0)
      frame.writeUInt32BE(0, 2);
      frame.writeUInt32BE(payload.length, 6);
    } else if (payload.length > 125) {
      frame[1] = 126;
      frame.writeUInt16BE(payload.length, 2);
    } else {
      frame[1] = payload.length;
    }

    payload.copy(frame, headerLength);
    return frame;
  }
}
