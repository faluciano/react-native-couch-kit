/**
 * Lightweight WebSocket Server Implementation
 * Built on top of react-native-tcp-socket
 *
 * Supports: text frames, close frames, ping/pong, multi-frame TCP packets,
 * and robust buffer management per RFC 6455.
 */

import TcpSocket from "react-native-tcp-socket";
import { EventEmitter } from "./event-emitter";
import { Buffer } from "buffer";
import { sha1 } from "js-sha1";

interface WebSocketConfig {
  port: number;
  debug?: boolean;
}

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

interface DecodedFrame {
  opcode: number;
  payload: Buffer;
  bytesConsumed: number;
}

export class GameWebSocketServer extends EventEmitter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private server: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private clients: Map<string, any>;
  private port: number;
  private debug: boolean;

  constructor(config: WebSocketConfig) {
    super();
    this.port = config.port;
    this.debug = !!config.debug;
    this.clients = new Map();
  }

  private log(...args: unknown[]) {
    if (this.debug) {
      console.log(...args);
    }
  }

  private generateSocketId(): string {
    // Generate a 21-character base36 ID for negligible collision probability
    const a = Math.random().toString(36).substring(2, 15); // 13 chars
    const b = Math.random().toString(36).substring(2, 10); // 8 chars
    return a + b;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public start() {
    this.log(`[WebSocket] Starting server on port ${this.port}...`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.server = TcpSocket.createServer((socket: any) => {
      this.log(
        `[WebSocket] New connection from ${socket.address?.()?.address}`,
      );
      let buffer: Buffer = Buffer.alloc(0);

      socket.on("data", (data: Buffer | string) => {
        this.log(
          `[WebSocket] Received data chunk: ${typeof data === "string" ? data.length : data.length} bytes`,
        );
        // Concatenate new data
        buffer = Buffer.concat([
          buffer,
          typeof data === "string" ? Buffer.from(data) : data,
        ]);

        // Handshake not yet performed?
        if (!socket.isHandshakeComplete) {
          const header = buffer.toString("utf8");
          const endOfHeader = header.indexOf("\r\n\r\n");
          if (endOfHeader !== -1) {
            this.handleHandshake(socket, header);
            // Retain any bytes after the handshake (could be the first WS frame)
            const headerByteLength = Buffer.byteLength(
              header.substring(0, endOfHeader + 4),
              "utf8",
            );
            buffer = buffer.slice(headerByteLength);
            socket.isHandshakeComplete = true;
            // Fall through to process any remaining frames below
          } else {
            return;
          }
        }

        // Process all complete frames in the buffer
        this.processFrames(socket, buffer, (remaining) => {
          buffer = remaining;
        });
      });

      socket.on("error", (error: Error) => {
        this.emit("error", error);
      });

      socket.on("close", () => {
        if (socket.id) {
          this.clients.delete(socket.id);
          this.emit("disconnect", socket.id);
        }
      });
    });

    this.server.listen({ port: this.port, host: "0.0.0.0" }, () => {
      this.log(`[WebSocket] Server listening on 0.0.0.0:${this.port}`);
      this.emit("listening", this.port);
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private processFrames(
    socket: any,
    buffer: Buffer,
    setBuffer: (b: Buffer) => void,
  ) {
    while (buffer.length > 0) {
      const frame = this.decodeFrame(buffer);
      if (!frame) {
        // Incomplete frame -- keep buffer, wait for more data
        break;
      }

      // Advance buffer past the consumed frame
      buffer = buffer.slice(frame.bytesConsumed);

      // Handle frame by opcode
      switch (frame.opcode) {
        case OPCODE.TEXT: {
          try {
            const message = JSON.parse(frame.payload.toString("utf8"));
            this.emit("message", socket.id, message);
          } catch (e) {
            // Corrupt JSON in a complete frame -- discard this frame, continue processing
            this.log(
              `[WebSocket] Invalid JSON from ${socket.id}, discarding frame`,
            );
          }
          break;
        }

        case OPCODE.CLOSE: {
          this.log(`[WebSocket] Close frame from ${socket.id}`);
          // Send close frame back (RFC 6455 Section 5.5.1)
          const closeFrame = Buffer.alloc(2);
          closeFrame[0] = 0x88; // FIN + Close opcode
          closeFrame[1] = 0x00; // No payload
          try {
            socket.write(closeFrame);
          } catch {
            // Socket may already be closing
          }
          socket.destroy();
          break;
        }

        case OPCODE.PING: {
          this.log(`[WebSocket] Ping from ${socket.id}`);
          // Respond with pong containing the same payload (RFC 6455 Section 5.5.3)
          const pongFrame = this.encodeControlFrame(OPCODE.PONG, frame.payload);
          try {
            socket.write(pongFrame);
          } catch {
            // Socket may be closing
          }
          break;
        }

        case OPCODE.PONG: {
          // Unsolicited pong -- safe to ignore (RFC 6455 Section 5.5.3)
          this.log(`[WebSocket] Pong from ${socket.id}`);
          break;
        }

        case OPCODE.BINARY: {
          // Binary frames not supported -- log and discard
          this.log(
            `[WebSocket] Binary frame from ${socket.id}, not supported -- discarding`,
          );
          break;
        }

        default: {
          this.log(
            `[WebSocket] Unknown opcode 0x${frame.opcode.toString(16)} from ${socket.id}, discarding`,
          );
          break;
        }
      }

      // If socket was destroyed (e.g., close frame), stop processing
      if (socket.destroyed) break;
    }

    setBuffer(buffer);
  }

  public stop() {
    if (this.server) {
      this.server.close();
      this.clients.forEach((socket) => socket.destroy());
      this.clients.clear();
    }
  }

  public send(socketId: string, data: unknown) {
    const socket = this.clients.get(socketId);
    if (socket) {
      const frame = this.encodeFrame(JSON.stringify(data));
      socket.write(frame);
    }
  }

  public broadcast(data: unknown, excludeId?: string) {
    const frame = this.encodeFrame(JSON.stringify(data));
    this.clients.forEach((socket, id) => {
      if (id !== excludeId) {
        socket.write(frame);
      }
    });
  }

  // --- Private Helpers ---

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleHandshake(socket: any, header: string) {
    this.log("[WebSocket] Handshake request header:", JSON.stringify(header));
    const keyMatch = header.match(/Sec-WebSocket-Key: (.+)/);
    if (!keyMatch) {
      console.error("[WebSocket] Handshake failed: No Sec-WebSocket-Key found");
      socket.destroy();
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
      socket.write(response);

      // Assign ID and store
      socket.id = this.generateSocketId();
      this.clients.set(socket.id, socket);
      this.emit("connection", socket.id);
    } catch (error) {
      console.error("[WebSocket] Handshake error:", error);
      socket.destroy();
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
        // Payload > 4GB -- reject
        throw new Error("Frame payload too large");
      }
      payloadLength = buffer.readUInt32BE(6);
      headerLength = 10;
    }

    const maskLength = isMasked ? 4 : 0;
    const totalFrameLength = headerLength + maskLength + payloadLength;

    // Check if we have the complete frame
    if (buffer.length < totalFrameLength) return null;

    let payload: Buffer;
    if (isMasked) {
      const mask = buffer.slice(headerLength, headerLength + 4);
      const maskedPayload = buffer.slice(
        headerLength + 4,
        headerLength + 4 + payloadLength,
      );
      payload = Buffer.alloc(payloadLength);
      for (let i = 0; i < payloadLength; i++) {
        payload[i] = maskedPayload[i] ^ mask[i % 4];
      }
    } else {
      payload = Buffer.from(
        buffer.slice(headerLength, headerLength + payloadLength),
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
