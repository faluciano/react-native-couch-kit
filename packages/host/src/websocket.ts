/**
 * Lightweight WebSocket Server Implementation
 * Built on top of react-native-tcp-socket
 */

import TcpSocket from 'react-native-tcp-socket';
import { EventEmitter } from 'events';
import { Buffer } from 'buffer';

interface WebSocketConfig {
  port: number;
}

// Simple WebSocket Frame Parser/Builder
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class GameWebSocketServer extends EventEmitter {
  private server: any;
  private clients: Map<string, any>;
  private port: number;

  constructor(config: WebSocketConfig) {
    super();
    this.port = config.port;
    this.clients = new Map();
  }

  public start() {
    this.server = TcpSocket.createServer((socket: any) => {
      let buffer = Buffer.alloc(0);

      socket.on('data', (data: Buffer | string) => {
        // Concatenate new data
        buffer = Buffer.concat([buffer, typeof data === 'string' ? Buffer.from(data) : data]);

        // Handshake not yet performed?
        if (!socket.isHandshakeComplete) {
          const header = buffer.toString('utf8');
          if (header.includes('\r\n\r\n')) {
            this.handleHandshake(socket, header);
            buffer = Buffer.alloc(0); // Clear buffer after handshake
            socket.isHandshakeComplete = true;
          }
          return;
        }

        // Process Frames
        try {
          const message = this.decodeFrame(buffer);
          if (message) {
            this.emit('message', socket.id, message);
            buffer = Buffer.alloc(0); // Clear buffer after processing
          }
        } catch (e) {
          // Incomplete frame, wait for more data
        }
      });

      socket.on('error', (error: Error) => {
        this.emit('error', error);
      });

      socket.on('close', () => {
        if (socket.id) {
            this.clients.delete(socket.id);
            this.emit('disconnect', socket.id);
        }
      });
    });

    this.server.listen({ port: this.port, host: '0.0.0.0' }, () => {
      this.emit('listening', this.port);
    });
  }

  public stop() {
    if (this.server) {
      this.server.close();
      this.clients.forEach(socket => socket.destroy());
      this.clients.clear();
    }
  }

  public send(socketId: string, data: any) {
    const socket = this.clients.get(socketId);
    if (socket) {
      const frame = this.encodeFrame(JSON.stringify(data));
      socket.write(frame);
    }
  }

  public broadcast(data: any, excludeId?: string) {
    const frame = this.encodeFrame(JSON.stringify(data));
    this.clients.forEach((socket, id) => {
      if (id !== excludeId) {
        socket.write(frame);
      }
    });
  }

  // --- Private Helpers ---

  private handleHandshake(socket: any, header: string) {
    const keyMatch = header.match(/Sec-WebSocket-Key: (.+)/);
    if (!keyMatch) {
        socket.destroy();
        return;
    }

    const key = keyMatch[1].trim();
    const acceptKey = this.generateAcceptKey(key);

    const response = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '\r\n'
    ].join('\r\n');

    socket.write(response);
    
    // Assign ID and store
    socket.id = Math.random().toString(36).substring(7);
    this.clients.set(socket.id, socket);
    this.emit('connection', socket.id);
  }

  private generateAcceptKey(key: string): string {
    const crypto = require('crypto');
    const sha1 = crypto.createHash('sha1');
    sha1.update(key + GUID);
    return sha1.digest('base64');
  }

  private decodeFrame(buffer: Buffer): any {
    // Basic decoding implementation (Masked frames from client)
    if (buffer.length < 2) return null;

    const secondByte = buffer[1];
    const isMasked = (secondByte & 0x80) !== 0;
    let payloadLength = secondByte & 0x7F;
    let maskStart = 2;

    if (payloadLength === 126) {
        payloadLength = buffer.readUInt16BE(2);
        maskStart = 4;
    } else if (payloadLength === 127) {
        // Ignore huge frames for MVP
        return null;
    }

    if (!isMasked) return null; // Clients must mask

    const mask = buffer.slice(maskStart, maskStart + 4);
    const payload = buffer.slice(maskStart + 4, maskStart + 4 + payloadLength);
    
    if (payload.length < payloadLength) return null; // Incomplete

    const unmasked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) {
        unmasked[i] = payload[i] ^ mask[i % 4];
    }

    return JSON.parse(unmasked.toString('utf8'));
  }

  private encodeFrame(data: string): Buffer {
    // Server -> Client frames are NOT masked
    const payload = Buffer.from(data);
    let lengthByte = payload.length;
    let headerLength = 2;
    
    if (payload.length > 65535) {
        // Not implemented for MVP
        lengthByte = 127;
    } else if (payload.length > 125) {
        lengthByte = 126;
        headerLength = 4;
    }

    const buffer = Buffer.alloc(headerLength + payload.length);
    buffer[0] = 0x81; // Text frame, FIN bit set

    if (lengthByte === 126) {
        buffer[1] = 126;
        buffer.writeUInt16BE(payload.length, 2);
    } else {
        buffer[1] = lengthByte;
    }

    payload.copy(buffer, headerLength);
    return buffer;
  }
}
