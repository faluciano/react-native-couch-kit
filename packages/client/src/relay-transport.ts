import {
  TransportReadyState,
  type ClientTransport,
  type CreateClientTransport,
} from "./transport";
import {
  RelayMessageTypes,
  relayRoomUrl,
  type RelayServerMessage,
} from "./relay-protocol";

/** Options for {@link createRelayTransport} / {@link RelayClientTransport}. */
export interface RelayTransportOptions {
  /** WebSocket URL of the relay server (e.g. `wss://relay.example.com`). */
  url: string;
  /** Room code identifying the display host to connect to. */
  roomId: string;
}

/**
 * Terminal close code (WebSocket policy violation). `close()` can't be called
 * with reserved codes like 1008, so the transport reports this to the client
 * directly via `onclose` while closing the socket with a permitted code.
 */
const POLICY_CLOSE_CODE = 1008;

/**
 * A {@link ClientTransport} that reaches the display host through the
 * cross-network relay instead of a direct LAN WebSocket.
 *
 * It opens a WebSocket to the relay, joins `roomId`, and then presents the same
 * open/message/close surface as the default transport — wrapping each outbound
 * game message in a relay `DATA` envelope and unwrapping inbound ones. Room-level
 * failures (unknown/full room) are surfaced as a terminal close so the client's
 * reconnect logic does not hammer a room that will never accept it.
 */
export class RelayClientTransport implements ClientTransport {
  private readonly ws: WebSocket;
  private readonly roomId: string;
  private state: number = TransportReadyState.CONNECTING;
  /** When set, the code reported to `onclose` instead of the raw socket code. */
  private pendingCloseCode: number | null = null;

  onopen?: () => void;
  onmessage?: (data: string) => void;
  onclose?: (code: number, reason?: string) => void;
  onerror?: (error?: unknown) => void;

  constructor(options: RelayTransportOptions) {
    this.roomId = options.roomId;
    this.ws = new WebSocket(relayRoomUrl(options.url, options.roomId));

    this.ws.onopen = () => {
      // The relay socket is up; ask to join the room. The transport is not yet
      // "open" to the client until the relay confirms with ROOM_JOINED.
      this.ws.send(
        JSON.stringify({
          type: RelayMessageTypes.JOIN_ROOM,
          roomId: this.roomId,
        }),
      );
    };

    this.ws.onmessage = (event: MessageEvent) => {
      let msg: RelayServerMessage;
      try {
        msg = JSON.parse(event.data as string) as RelayServerMessage;
      } catch {
        return;
      }
      this.handleRelayMessage(msg);
    };

    this.ws.onclose = (event: CloseEvent) => {
      this.state = TransportReadyState.CLOSED;
      const code = this.pendingCloseCode ?? event.code;
      this.onclose?.(code, event.reason);
    };

    this.ws.onerror = (event) => this.onerror?.(event);
  }

  get readyState(): number {
    return this.state;
  }

  send(data: string): void {
    if (this.state !== TransportReadyState.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: RelayMessageTypes.DATA,
        roomId: this.roomId,
        data,
      }),
    );
  }

  close(code?: number, reason?: string): void {
    this.state = TransportReadyState.CLOSING;
    // WebSocket.close only permits 1000 or 3000-4999; pass through only those.
    if (code !== undefined && (code === 1000 || (code >= 3000 && code <= 4999))) {
      this.ws.close(code, reason);
    } else {
      this.ws.close();
    }
  }

  private handleRelayMessage(msg: RelayServerMessage): void {
    switch (msg.type) {
      case RelayMessageTypes.ROOM_JOINED:
        this.state = TransportReadyState.OPEN;
        this.onopen?.();
        break;
      case RelayMessageTypes.DATA:
        this.onmessage?.(msg.data);
        break;
      case RelayMessageTypes.ERROR:
        // Room-level failures are terminal: report a policy close so the client
        // does not attempt to reconnect, then close the underlying socket.
        this.pendingCloseCode = POLICY_CLOSE_CODE;
        this.ws.close();
        break;
      // PEER_JOINED / PEER_LEFT / ROOM_CREATED are host-facing; ignored here.
    }
  }
}

/**
 * Build a {@link CreateClientTransport} factory for `useGameClient` that
 * connects through the relay.
 *
 * @example
 * ```tsx
 * useGameClient({
 *   reducer,
 *   initialState,
 *   createTransport: createRelayTransport({ url: RELAY_URL, roomId }),
 * });
 * ```
 */
export function createRelayTransport(
  options: RelayTransportOptions,
): CreateClientTransport {
  return () => new RelayClientTransport(options);
}
