import { MessageTypes, type ClientMessage } from "@couch-kit/core";

/**
 * Default maximum size (in bytes) of an inbound client message. Frames larger
 * than this are discarded before `JSON.parse`, bounding the memory a single
 * malicious LAN client can force the host to allocate. Generous enough for
 * data-URI avatars in JOIN payloads while blocking multi-megabyte abuse.
 */
export const DEFAULT_MAX_MESSAGE_BYTES = 256 * 1024;

/**
 * Compute the UTF-8 byte length of a raw WebSocket frame payload.
 *
 * For binary frames the `ArrayBuffer.byteLength` is exact. For text frames the
 * UTF-8 size is counted directly from the JS string without allocating an
 * encoder buffer, so an oversized frame can be rejected cheaply.
 */
export function frameByteLength(data: string | ArrayBuffer): number {
  if (typeof data !== "string") return data.byteLength;

  let bytes = 0;
  for (let i = 0; i < data.length; i++) {
    const code = data.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate: a full pair encodes to 4 UTF-8 bytes.
      bytes += 4;
      i++; // Skip the paired low surrogate.
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

type ClientMessageOf<TType extends ClientMessage["type"]> = Extract<
  ClientMessage,
  { type: TType }
>;

export type ValidatedClientMessage =
  | {
      type: typeof MessageTypes.JOIN;
      payload: {
        name: string;
        secret?: unknown;
        avatar?: unknown;
        [key: string]: unknown;
      };
    }
  | ClientMessageOf<"ACTION">
  | ClientMessageOf<"PING">
  | ClientMessageOf<"ASSETS_LOADED">;

/**
 * Validates that an incoming message has the expected shape.
 * Returns true if the message has a processable client-message shape.
 */
export function isValidClientMessage(
  msg: unknown,
): msg is ValidatedClientMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  if (typeof m.type !== "string") return false;

  switch (m.type) {
    case MessageTypes.JOIN:
      return (
        typeof m.payload === "object" &&
        m.payload !== null &&
        typeof (m.payload as Record<string, unknown>).name === "string"
      );
    case MessageTypes.ACTION:
      return (
        typeof m.payload === "object" &&
        m.payload !== null &&
        typeof (m.payload as Record<string, unknown>).type === "string"
      );
    case MessageTypes.PING:
      return (
        typeof m.payload === "object" &&
        m.payload !== null &&
        typeof (m.payload as Record<string, unknown>).id === "string" &&
        typeof (m.payload as Record<string, unknown>).timestamp === "number"
      );
    case MessageTypes.ASSETS_LOADED:
      return m.payload === true;
    default:
      return false;
  }
}
