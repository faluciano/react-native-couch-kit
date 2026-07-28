import {
  GameHostRuntime,
  frameByteLength,
  DEFAULT_MAX_MESSAGE_BYTES,
  type AddressedMessage,
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
export interface RelayDisplayHostOptions<
  S extends IGameState,
  A extends IAction,
> extends GameHostRuntimeConfig<S, A> {
  /** WebSocket URL of the shared relay server. */
  url: string;
  /**
   * Room code phones will use to reach this display.
   *
   * Omit it — the normal case — and the relay allocates one, reporting it via
   * {@link RelayDisplayHostOptions.onRoomCode} and {@link RelayDisplayHost.roomCode}.
   * Only the relay can tell whether a code is already in use, so a code chosen
   * here may be rejected as `ROOM_EXISTS`; supply one only when something
   * outside the relay already fixed it.
   */
  roomId?: string;
  /**
   * Called once the room exists and its code is known.
   *
   * A minted code is not available synchronously, so a display renders a
   * placeholder until this fires — roughly a round trip to the relay.
   */
  onRoomCode?: (roomCode: string) => void;
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
  /** Null until the relay confirms the room, when the code is relay-assigned. */
  private assignedRoomId: string | null;
  private readonly onRoomCode?: (roomCode: string) => void;
  /** Connected phone connection ids (relay peer ids). */
  private readonly peers = new Set<string>();

  constructor(options: RelayDisplayHostOptions<S, A>) {
    const { url, roomId, onRoomCode, ...runtimeConfig } = options;
    this.assignedRoomId = roomId ?? null;
    this.onRoomCode = onRoomCode;
    this.runtime = new GameHostRuntime<S, A>(runtimeConfig);
    this.ws = new WebSocket(relayRoomUrl(url, roomId));

    this.ws.onopen = () => {
      // No roomId asks the relay to allocate one. Sending the field as
      // undefined omits it from the JSON, which is what the relay reads as
      // "you pick".
      this.ws.send(
        JSON.stringify({
          type: RelayMessageTypes.CREATE_ROOM,
          roomId: this.assignedRoomId ?? undefined,
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
      send: (connectionId, message) => this.sendEnvelope(message, connectionId),
      broadcast: (message) => this.sendEnvelope(message),
      sendMany: (entries) => this.sendMultiEnvelope(entries),
    };
    this.runtime.setTransport(transport);
  }

  /**
   * The room code phones join with, or `null` before the relay has assigned
   * one. See {@link RelayDisplayHostOptions.onRoomCode} to be told when it
   * arrives.
   */
  get roomCode(): string | null {
    return this.assignedRoomId;
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

  /**
   * Sends per-connection messages as one `DATA_MULTI` frame, which the relay
   * unpacks into an ordinary `DATA` frame per phone.
   *
   * A projected game re-sends every player's view on every state change, so on
   * a four-player table this is the difference between one billed relay message
   * and four — and between one and four against the relay's per-connection rate
   * limit, which the display shares across all its fan-out.
   *
   * Falls back to individual sends if the combined frame would exceed the
   * relay's message ceiling: N views in one envelope is N times the bytes, and
   * a frame the relay rejects delivers nothing to anyone. Splitting costs
   * messages; being dropped costs the game.
   */
  private sendMultiEnvelope(entries: readonly AddressedMessage[]): void {
    const payloads: Record<string, string> = {};
    for (const { connectionId, message } of entries) {
      payloads[connectionId] = JSON.stringify(message);
    }

    const frame = JSON.stringify({
      type: RelayMessageTypes.DATA_MULTI,
      roomId: this.assignedRoomId ?? undefined,
      payloads,
    });

    if (frameByteLength(frame) > DEFAULT_MAX_MESSAGE_BYTES) {
      for (const { connectionId, message } of entries) {
        this.sendEnvelope(message, connectionId);
      }
      return;
    }

    this.ws.send(frame);
  }

  private sendEnvelope(message: HostMessage, to?: string): void {
    const envelope: Record<string, unknown> = {
      type: RelayMessageTypes.DATA,
      // The relay routes by the sender's membership, not this field, so it is
      // only ever informational — and nothing is sent before a peer joins,
      // which cannot happen until the room exists.
      roomId: this.assignedRoomId ?? undefined,
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
      case RelayMessageTypes.ROOM_CREATED:
        // Carries the code when the relay chose it, and confirms the code when
        // the caller supplied one.
        this.assignedRoomId = msg.roomId;
        this.onRoomCode?.(msg.roomId);
        break;
      case RelayMessageTypes.ERROR:
        this.runtime.handleError(new Error(msg.message));
        break;
      // ROOM_JOINED is an acknowledgement; no action needed.
    }
  }
}
