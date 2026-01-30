import { EventEmitter } from 'events';

// Since the EventEmitter type definition might not perfectly match the Node.js one in RN environment,
// we'll declare the interface we expect.
export interface GameWebSocketServer extends EventEmitter {
    on(event: 'connection', listener: (socketId: string) => void): this;
    on(event: 'message', listener: (socketId: string, message: any) => void): this;
    on(event: 'disconnect', listener: (socketId: string) => void): this;
    on(event: 'listening', listener: (port: number) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    
    emit(event: 'connection', socketId: string): boolean;
    emit(event: 'message', socketId: string, message: any): boolean;
    emit(event: 'disconnect', socketId: string): boolean;
    emit(event: 'listening', port: number): boolean;
    emit(event: 'error', error: Error): boolean;
}
