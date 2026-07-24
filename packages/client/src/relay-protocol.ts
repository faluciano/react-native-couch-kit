/**
 * Wire protocol for the cross-network **relay** transport.
 *
 * The relay is a small, game-agnostic WebSocket server that routes the existing
 * Couch Kit JSON protocol between a browser **display host** (which owns the
 * authoritative `GameHostRuntime`) and one or more **phones**, in a star
 * topology keyed by a room id. The relay never inspects game payloads — it only
 * tracks room membership and routes envelopes.
 *
 * These types are shared by the relay client transport (this package), the
 * reference display host, and the relay server so all three agree on the wire
 * format.
 */

/** Envelope/control message discriminators exchanged with the relay server. */
export const RelayMessageTypes = {
  /** Display → relay: create and host a room under `roomId`. */
  CREATE_ROOM: "CREATE_ROOM",
  /** Relay → display: room created; includes the display's own `peerId`. */
  ROOM_CREATED: "ROOM_CREATED",
  /** Phone → relay: join an existing room. */
  JOIN_ROOM: "JOIN_ROOM",
  /** Relay → phone: joined; includes the phone's assigned `peerId`. */
  ROOM_JOINED: "ROOM_JOINED",
  /** Relay → display: a phone joined the room. */
  PEER_JOINED: "PEER_JOINED",
  /** Relay → display: a phone left the room. */
  PEER_LEFT: "PEER_LEFT",
  /** Bidirectional: carries an opaque Couch Kit JSON message as `data`. */
  DATA: "DATA",
  /** Relay → client: a protocol/room error. */
  ERROR: "ERROR",
} as const;

/** Error codes the relay may report in an {@link RelayErrorMessage}. */
export const RelayErrorCodes = {
  ROOM_NOT_FOUND: "ROOM_NOT_FOUND",
  ROOM_EXISTS: "ROOM_EXISTS",
  ROOM_FULL: "ROOM_FULL",
  NOT_IN_ROOM: "NOT_IN_ROOM",
  MESSAGE_TOO_LARGE: "MESSAGE_TOO_LARGE",
  MALFORMED: "MALFORMED",
} as const;

export type RelayErrorCode =
  (typeof RelayErrorCodes)[keyof typeof RelayErrorCodes];

/** Display → relay: create and host a room. */
export interface CreateRoomMessage {
  type: typeof RelayMessageTypes.CREATE_ROOM;
  roomId: string;
}

/** Relay → display: room created; `peerId` is the display's own id. */
export interface RoomCreatedMessage {
  type: typeof RelayMessageTypes.ROOM_CREATED;
  roomId: string;
  peerId: string;
}

/** Phone → relay: join an existing room. */
export interface JoinRoomMessage {
  type: typeof RelayMessageTypes.JOIN_ROOM;
  roomId: string;
}

/** Relay → phone: joined; `peerId` is the phone's relay-assigned id. */
export interface RoomJoinedMessage {
  type: typeof RelayMessageTypes.ROOM_JOINED;
  roomId: string;
  peerId: string;
}

/** Relay → display: a phone joined; `peerId` becomes its connection id. */
export interface PeerJoinedMessage {
  type: typeof RelayMessageTypes.PEER_JOINED;
  roomId: string;
  peerId: string;
}

/** Relay → display: a phone left. */
export interface PeerLeftMessage {
  type: typeof RelayMessageTypes.PEER_LEFT;
  roomId: string;
  peerId: string;
}

/**
 * Bidirectional data envelope carrying an opaque Couch Kit JSON message.
 *
 * - Phone → relay: `data` only; the relay injects `from` and routes to the host.
 * - Relay → display: `from` = sending phone's `peerId`.
 * - Display → relay: `to` present = unicast to that phone; `to` absent =
 *   broadcast to every phone in the room.
 * - Relay → phone: `data` only.
 *
 * `data` is the already-serialized Couch Kit message string, so the relay
 * treats it as opaque.
 */
export interface DataMessage {
  type: typeof RelayMessageTypes.DATA;
  roomId: string;
  from?: string;
  to?: string;
  data: string;
}

/** Relay → client: a protocol/room error. */
export interface RelayErrorMessage {
  type: typeof RelayMessageTypes.ERROR;
  code: RelayErrorCode;
  message: string;
}

/** Any message a client may send to the relay. */
export type RelayClientMessage =
  | CreateRoomMessage
  | JoinRoomMessage
  | DataMessage;

/** Any message the relay may send to a client. */
export type RelayServerMessage =
  | RoomCreatedMessage
  | RoomJoinedMessage
  | PeerJoinedMessage
  | PeerLeftMessage
  | DataMessage
  | RelayErrorMessage;

/** Every relay wire message. */
export type RelayMessage = RelayClientMessage | RelayServerMessage;
