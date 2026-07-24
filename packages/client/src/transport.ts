/**
 * Transport abstraction for the web game client.
 *
 * The client hook (`useGameClient`) speaks to the host through a small
 * WebSocket-shaped interface rather than a concrete `WebSocket`. This lets the
 * default LAN WebSocket transport and alternative transports (e.g. a
 * cross-network relay) be swapped in without touching the hook's JOIN handshake,
 * reconnect/backoff, session-recovery, or state-hydration logic.
 *
 * The interface intentionally mirrors the subset of the `WebSocket` API the
 * client relies on, so the default implementation is a thin wrapper and the
 * behavior of the LAN path is unchanged.
 */

/**
 * Ready-state constants mirroring the `WebSocket` readyState values. A transport
 * reports these so the client can gate sends on an open connection without
 * depending on the global `WebSocket` constructor (which may be absent in some
 * runtimes/tests).
 */
export const TransportReadyState = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

/**
 * The minimal message-transport surface the client requires.
 *
 * Implementations deliver and receive already-serialized JSON strings. Event
 * callbacks are assigned by the client after construction, so a transport must
 * begin connecting on construction and invoke `onopen` once ready.
 */
export interface ClientTransport {
  /** Current connection state; compare against {@link TransportReadyState}. */
  readonly readyState: number;
  /** Send a serialized JSON message to the host. */
  send(data: string): void;
  /**
   * Close the connection. `code`/`reason` follow WebSocket close semantics so
   * the client's recoverable-vs-terminal reconnect logic keeps working
   * (1008 policy / 1011 internal error are treated as terminal).
   */
  close(code?: number, reason?: string): void;
  /** Invoked once the connection is open and ready to send. */
  onopen?: () => void;
  /** Invoked with the raw JSON string of each inbound host message. */
  onmessage?: (data: string) => void;
  /** Invoked when the connection closes, with a WebSocket-compatible code. */
  onclose?: (code: number, reason?: string) => void;
  /** Invoked on a transport-level error. */
  onerror?: (error?: unknown) => void;
}

/**
 * Factory that creates a fresh {@link ClientTransport}. `useGameClient` calls
 * this each time it (re)connects, so implementations must return a new,
 * already-connecting transport on every call.
 */
export type CreateClientTransport = () => ClientTransport;

/**
 * The default LAN transport: a thin wrapper around the browser `WebSocket` that
 * adapts its event objects to the normalized {@link ClientTransport} callbacks
 * (`onmessage(data)` instead of `event.data`; `onclose(code)` instead of
 * `event.code`). Behavior is identical to using `WebSocket` directly.
 */
export function createWebSocketTransport(url: string): ClientTransport {
  const ws = new WebSocket(url);

  const transport: ClientTransport = {
    get readyState() {
      return ws.readyState;
    },
    send(data: string) {
      ws.send(data);
    },
    close(code?: number, reason?: string) {
      ws.close(code, reason);
    },
  };

  ws.onopen = () => transport.onopen?.();
  ws.onmessage = (event: MessageEvent) =>
    transport.onmessage?.(event.data as string);
  ws.onclose = (event: CloseEvent) =>
    transport.onclose?.(event.code, event.reason);
  ws.onerror = (event) => transport.onerror?.(event);

  return transport;
}
