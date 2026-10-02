import {
  GameHostRuntime,
  frameByteLength,
  DEFAULT_MAX_MESSAGE_BYTES,
  type AddressedMessage,
  type GameHostRuntimeConfig,
  type GameRuntimeTransport,
  type RuntimeActionListener,
} from "@couch-kit/runtime";
import type { IGameState, IAction, HostMessage } from "@couch-kit/core";
import {
  RELAY_CLOSE_HOST_REPLACED,
  RELAY_HOST_RESUME_GRACE_MS,
  RelayErrorCodes,
  RelayMessageTypes,
  relayRoomUrl,
  type RelayErrorCode,
  type RelayServerMessage,
} from "@couch-kit/client";

/**
 * Default minimum interval (ms) between state broadcasts through a relay.
 *
 * Slower than the LAN default on purpose: every frame the display sends is
 * billed by the relay and counted against the display's rate limit, whose
 * breach closes the socket — and, for the display, ends the room. 20
 * broadcasts/second is smooth for a party game and leaves the display's budget
 * (1200 messages/second on the reference relays) to the unicast replies it
 * also sends: WELCOME, PONG, errors.
 */
export const DEFAULT_RELAY_STATE_THROTTLE_MS = 50;

/**
 * Where the display's relay connection stands.
 *
 * - `connecting` — socket opening, or open but the room not yet confirmed.
 * - `open` — the room exists and phones can join.
 * - `reconnecting` — the connection dropped and the display is taking its
 *   room back. Phones stay connected to the relay meanwhile, and what they
 *   send is delivered once the room resumes.
 * - `closed` — the relay connection is gone, and the room with it. Terminal:
 *   the game state is still readable, but a new {@link RelayDisplayHost} (and a
 *   new room code) is needed for phones to rejoin.
 */
export type RelayDisplayStatus =
  "connecting" | "open" | "reconnecting" | "closed";

/** First delay before a reconnect attempt, doubled per failure. */
const RECONNECT_BASE_DELAY_MS = 250;
/** Longest wait between reconnect attempts. */
const RECONNECT_MAX_DELAY_MS = 4_000;

/** An error reported by the relay, carrying its machine-readable code. */
export class RelayError extends Error {
  readonly code: RelayErrorCode;

  constructor(code: RelayErrorCode, message: string) {
    super(message);
    this.name = "RelayError";
    this.code = code;
  }
}

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
  /**
   * Called whenever {@link RelayDisplayHost.status} changes. `closed` is the
   * one worth acting on: the room is gone, so show the players something
   * rather than a board that will never update again.
   */
  onStatusChange?: (status: RelayDisplayStatus) => void;
  /**
   * Whether to take the room back after the relay connection drops. Default
   * `true`: a display whose network blinks reconnects within the relay's grace
   * period (30 seconds on the reference relays) and keeps its room code and
   * its phones. Set `false` to have any drop end the room, as before.
   */
  resume?: boolean;
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
  private readonly url: string;
  /** The current relay socket; replaced on each reconnect. */
  private ws!: WebSocket;
  /** Null until the relay confirms the room, when the code is relay-assigned. */
  private assignedRoomId: string | null;
  private readonly onRoomCode?: (roomCode: string) => void;
  private readonly onStatusChange?: (status: RelayDisplayStatus) => void;
  private readonly resumeEnabled: boolean;
  /** Connected phone connection ids (relay peer ids). */
  private readonly peers = new Set<string>();
  private currentStatus: RelayDisplayStatus = "connecting";
  /** Whether frames can be written; a socket still connecting throws on send. */
  private socketOpen = false;
  private stopped = false;
  /** The room's resume credential, from `ROOM_CREATED`. */
  private resumeToken: string | null = null;
  /** When the connection dropped, while reconnecting. */
  private awaySince: number | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: RelayDisplayHostOptions<S, A>) {
    const {
      url,
      roomId,
      onRoomCode,
      onStatusChange,
      resume,
      ...runtimeConfig
    } = options;
    this.url = url;
    this.assignedRoomId = roomId ?? null;
    this.onRoomCode = onRoomCode;
    this.onStatusChange = onStatusChange;
    this.resumeEnabled = resume ?? true;
    this.runtime = new GameHostRuntime<S, A>({
      ...runtimeConfig,
      stateThrottleMs:
        runtimeConfig.stateThrottleMs ?? DEFAULT_RELAY_STATE_THROTTLE_MS,
    });
    this.connect();

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

  /** Where the relay connection stands. See {@link RelayDisplayStatus}. */
  get status(): RelayDisplayStatus {
    return this.currentStatus;
  }

  /** Current authoritative game state. */
  getState = (): S => this.runtime.getState();

  /** Subscribe to state changes (for `useSyncExternalStore` or manual render). */
  subscribe = (listener: () => void): (() => void) =>
    this.runtime.subscribe(listener);

  /**
   * Subscribe to every action the runtime reduces — the display's own
   * dispatches, players' actions, and join/leave lifecycle actions. A
   * `RelayDisplayHost` can be passed straight to `useActionRecorder({ source })`.
   */
  subscribeActions = (listener: RuntimeActionListener<S, A>): (() => void) =>
    this.runtime.subscribeActions(listener);

  /** Dispatch a trusted host-display action. */
  dispatch = (action: A): void => this.runtime.dispatch(action);

  /** Tear down the runtime and relay socket. */
  stop(): void {
    this.stopped = true;
    this.socketOpen = false;
    this.clearReconnectTimer();
    this.peers.clear();
    this.runtime.setTransport(null);
    this.runtime.stop();
    // A deliberate close: the relay ends the room now rather than holding it
    // for a resume that will never come.
    this.ws.close(1000, "Display stopped");
    this.setStatus("closed");
  }

  /**
   * Opens a relay socket and either creates the room or, once the relay has
   * issued a resume token, takes it back.
   *
   * Every handler checks that its socket is still the current one: a socket
   * replaced by a reconnect may still deliver a late close or message, and
   * acting on it would tear down the connection that replaced it.
   */
  private connect(): void {
    const resumeToken = this.resumeToken;
    const ws = new WebSocket(
      relayRoomUrl(this.url, this.assignedRoomId ?? undefined),
    );
    this.ws = ws;

    ws.onopen = () => {
      if (ws !== this.ws) return;
      this.socketOpen = true;
      // No roomId asks the relay to allocate one. Sending the field as
      // undefined omits it from the JSON, which is what the relay reads as
      // "you pick".
      ws.send(
        JSON.stringify({
          type: RelayMessageTypes.CREATE_ROOM,
          roomId: this.assignedRoomId ?? undefined,
          resumeToken: resumeToken ?? undefined,
        }),
      );
    };

    ws.onmessage = (event: MessageEvent) => {
      if (ws !== this.ws) return;
      let msg: RelayServerMessage;
      try {
        msg = JSON.parse(event.data as string) as RelayServerMessage;
      } catch {
        return;
      }
      this.handleRelayMessage(msg);
    };

    ws.onerror = (event) => {
      // A failed reconnect attempt is expected while the network is down; its
      // close event decides what happens next.
      if (ws !== this.ws || this.currentStatus === "reconnecting") return;
      this.runtime.handleError(
        event instanceof Error ? event : new Error("Relay socket error"),
      );
    };

    ws.onclose = (event: CloseEvent) => {
      if (ws !== this.ws) return;
      this.handleSocketClose(event);
    };
  }

  private setStatus(status: RelayDisplayStatus): void {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    this.onStatusChange?.(status);
  }

  /**
   * The relay connection ended. If the room can still be taken back, try;
   * otherwise the room is gone.
   */
  private handleSocketClose(event: CloseEvent): void {
    this.socketOpen = false;
    if (this.stopped) return;

    if (this.canResume(event)) {
      this.awaySince ??= Date.now();
      this.setStatus("reconnecting");
      this.scheduleReconnect();
      return;
    }

    this.endRoom(
      `Relay connection closed (code ${event?.code ?? "unknown"})` +
        (event?.reason ? `: ${event.reason}` : ""),
    );
  }

  /**
   * Whether a drop is worth reconnecting after: the room exists and has a
   * token, and the relay did not end it on purpose. A policy close (rate
   * limited) ends the room on the relay's side, and a replaced host means
   * another connection holds the token now.
   */
  private canResume(event: CloseEvent): boolean {
    if (!this.resumeEnabled || this.resumeToken === null) return false;
    const code = event?.code;
    if (code === 1008 || code === RELAY_CLOSE_HOST_REPLACED) return false;
    return this.awaySince === null || this.timeLeftToResume() > 0;
  }

  /** How long until the relay gives up on this display. */
  private timeLeftToResume(): number {
    if (this.awaySince === null) return RELAY_HOST_RESUME_GRACE_MS;
    return this.awaySince + RELAY_HOST_RESUME_GRACE_MS - Date.now();
  }

  private scheduleReconnect(): void {
    const remaining = this.timeLeftToResume();
    if (remaining <= 0) {
      this.endRoom("Could not reach the relay before the room expired");
      return;
    }
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempts,
      RECONNECT_MAX_DELAY_MS,
      remaining,
    );
    this.reconnectAttempts++;
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  /**
   * The room is gone, and every phone with it: mark them disconnected so the
   * state on screen says so, and report the loss.
   */
  private endRoom(reason: string): void {
    this.clearReconnectTimer();
    this.resumeToken = null;
    this.awaySince = null;
    for (const peerId of this.peers) {
      this.runtime.handleDisconnect(peerId);
    }
    this.peers.clear();
    this.setStatus("closed");
    this.runtime.handleError(new Error(reason));
  }

  /**
   * The room is ours again. Phones that left while the display was away are
   * disconnected, phones that arrived are connected (their JOINs follow as
   * ordinary DATA), and everyone gets the current state: updates sent while
   * the socket was down never left this machine.
   */
  private handleResumed(peers: readonly string[]): void {
    const present = new Set(peers);
    for (const peerId of Array.from(this.peers)) {
      if (present.has(peerId)) continue;
      this.peers.delete(peerId);
      this.runtime.handleDisconnect(peerId);
    }
    for (const peerId of present) {
      if (this.peers.has(peerId)) continue;
      this.peers.add(peerId);
      this.runtime.handleConnection(peerId);
    }
    this.awaySince = null;
    this.reconnectAttempts = 0;
    this.setStatus("open");
    this.runtime.resendState();
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
    if (!this.socketOpen) return;

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
    // Nothing to write to yet (or any more): a socket that is still connecting
    // throws on send, and the runtime may broadcast before it opens.
    if (!this.socketOpen) return;
    // A room broadcast with nobody in it is a frame the relay bills and
    // rate-limits for no reader. A phone that joins later gets the whole state
    // in its WELCOME.
    if (to === undefined && this.peers.size === 0) return;

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
        this.resumeToken = msg.resumeToken ?? null;
        this.setStatus("open");
        this.onRoomCode?.(msg.roomId);
        break;
      case RelayMessageTypes.ROOM_RESUMED:
        this.handleResumed(msg.peers);
        break;
      case RelayMessageTypes.ERROR:
        // The relay no longer has the room (or the token): it expired, or
        // the relay restarted. Nothing left to reconnect to.
        if (
          this.currentStatus === "reconnecting" &&
          msg.code === RelayErrorCodes.ROOM_NOT_FOUND
        ) {
          this.socketOpen = false;
          this.ws.close(1000, "Room expired");
          this.endRoom("The room expired before the display reconnected");
          break;
        }
        this.runtime.handleError(new RelayError(msg.code, msg.message));
        break;
      // ROOM_JOINED is an acknowledgement; no action needed.
    }
  }
}
