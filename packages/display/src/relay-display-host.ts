import {
  GameHostRuntime,
  frameByteLength,
  DEFAULT_MAX_MESSAGE_BYTES,
  type GameHostRuntimeConfig,
  type GameRuntimeTransport,
} from "@couch-kit/runtime";
import type { IGameState, IAction, HostMessage } from "@couch-kit/core";
import {
  RelayMessageTypes,
  relayRoomUrl,
  type RelayServerMessage,
} from "@couch-kit/client";

/**
 * Options for {@link RelayDisplayHost}.
 *
 * The caller supplies the game's runtime config (reducer + initial state, same
 * object used by the RN-TV host) and the shared relay coordinates; the display
 * host owns the authoritative runtime and the relay socket.
 */
export interface RelayDisplayHostOptions<S extends IGameState, A extends IAction>
  extends GameHostRuntimeConfig<S, A> {
  /** WebSocket URL of the shared relay server. */
  url: string;
  /** Room code phones will use to reach this display. */
  roomId: string;
}

/**
 * Browser **display host** for the cross-network relay transport.
 *
 * It owns a {@link GameHostRuntime} (the authoritative game) exactly like the
 * React Native `GameHostProvider` does, but bridges the runtime to a shared,
 * game-agnostic relay instead of a local WebSocket server:
 *
 * - Connects to the relay and creates the room.
 * - Maps relay `PEER_JOINED` / `DATA` / `PEER_LEFT` to
 *   `runtime.handleConnection` / `handleMessage` / `handleDisconnect`, using the
 *   relay-assigned `peerId` as the stable connection id.
 * - Implements {@link GameRuntimeTransport} by wrapping outbound host messages in
 *   relay `DATA` envelopes (`to` for unicast, absent for room broadcast).
 *
 * Framework-agnostic (no React): a display UI subscribes via {@link subscribe} /
 * {@link getState} (e.g. React's `useSyncExternalStore`).
 */
export class RelayDisplayHost<S extends IGameState, A extends IAction> {
  private readonly runtime: GameHostRuntime<S, A>;
  private readonly ws: WebSocket;
  private readonly roomId: string;
  /** Connected phone connection ids (relay peer ids). */
  private readonly peers = new Set<string>();

  constructor(options: RelayDisplayHostOptions<S, A>) {
    const { url, roomId, ...runtimeConfig } = options;
    this.roomId = roomId;
    this.runtime = new GameHostRuntime<S, A>(runtimeConfig);
    this.ws = new WebSocket(relayRoomUrl(url, roomId));

    this.ws.onopen = () => {
      this.ws.send(
        JSON.stringify({
          type: RelayMessageTypes.CREATE_ROOM,
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

    this.ws.onerror = (event) =>
      this.runtime.handleError(
        event instanceof Error ? event : new Error("Relay socket error"),
      );

    const transport: GameRuntimeTransport = {
      send: (connectionId, message) =>
        this.sendEnvelope(message, connectionId),
      broadcast: (message) => this.sendEnvelope(message),
    };
    this.runtime.setTransport(transport);
  }

  /** Current authoritative game state. */
  getState = (): S => this.runtime.getState();

  /** Subscribe to state changes (for `useSyncExternalStore` or manual render). */
  subscribe = (listener: () => void): (() => void) =>
    this.runtime.subscribe(listener);

  /** Dispatch a trusted host-display action. */
  dispatch = (action: A): void => this.runtime.dispatch(action);

  /** Tear down the runtime and relay socket. */
  stop(): void {
    this.runtime.setTransport(null);
    this.runtime.stop();
    this.ws.close();
  }

  private sendEnvelope(message: HostMessage, to?: string): void {
    const envelope: Record<string, unknown> = {
      type: RelayMessageTypes.DATA,
      roomId: this.roomId,
      data: JSON.stringify(message),
    };
    if (to !== undefined) envelope.to = to;
    this.ws.send(JSON.stringify(envelope));
  }

  private handleRelayMessage(msg: RelayServerMessage): void {
    switch (msg.type) {
      case RelayMessageTypes.PEER_JOINED:
        this.peers.add(msg.peerId);
        this.runtime.handleConnection(msg.peerId);
        break;
      case RelayMessageTypes.PEER_LEFT:
        this.peers.delete(msg.peerId);
        this.runtime.handleDisconnect(msg.peerId);
        break;
      case RelayMessageTypes.DATA: {
        // A game message from a phone. `from` is the phone's connection id.
        if (!msg.from) break;
        // Enforce the same inbound bound as the WebSocket transport before
        // parsing untrusted phone input.
        if (frameByteLength(msg.data) > DEFAULT_MAX_MESSAGE_BYTES) break;
        let parsed: unknown;
        try {
          parsed = JSON.parse(msg.data);
        } catch {
          break;
        }
        this.runtime
          .handleMessage(msg.from, parsed)
          .catch((err) =>
            this.runtime.handleError(
              err instanceof Error ? err : new Error(String(err)),
            ),
          );
        break;
      }
      case RelayMessageTypes.ERROR:
        this.runtime.handleError(new Error(msg.message));
        break;
      // ROOM_CREATED / ROOM_JOINED are acknowledgements; no action needed.
    }
  }
}
