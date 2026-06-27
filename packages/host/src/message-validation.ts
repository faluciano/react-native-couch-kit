import { MessageTypes, type ClientMessage } from "@couch-kit/core";

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
