// Client -> Host Messages
export type ClientMessage =
  | {
      type: "JOIN";
      payload: { name: string; avatar?: string; secret: string };
    }
  | {
      type: "ACTION";
      payload: { type: string; payload?: unknown };
      /**
       * Optional client-chosen ID. When present the host answers with an
       * `ACTION_RESULT` carrying it, instead of staying silent on success or
       * sending an `ERROR` on rejection. At most {@link MAX_ACTION_ID_LENGTH}
       * characters.
       */
      id?: string;
    }
  | { type: "PING"; payload: { id: string; timestamp: number } }
  | { type: "ASSETS_LOADED"; payload: true };

// Host -> Client Messages
export type HostMessage =
  | {
      type: "WELCOME";
      payload: { playerId: string; state: unknown; serverTime: number };
    }
  | {
      type: "STATE_UPDATE";
      payload: { action?: unknown; newState: unknown; timestamp: number };
    }
  | {
      type: "PONG";
      payload: { id: string; origTimestamp: number; serverTime: number };
    }
  | { type: "RECONNECTED"; payload: { playerId: string; state: unknown } }
  | { type: "ERROR"; payload: { code: string; message: string } }
  | { type: "ACTION_RESULT"; payload: ActionResult & { id: string } };

/**
 * The host's answer to an `ACTION` sent with an `id`: applied (whether or not
 * it changed the state), or refused with an {@link ErrorCode} and a reason.
 */
export type ActionResult =
  | { ok: true }
  | { ok: false; code: ErrorCode | (string & {}); message: string };

/** Longest `id` a client may put on an `ACTION`. */
export const MAX_ACTION_ID_LENGTH = 64;

/** Codes the host sends in `ERROR` and failed `ACTION_RESULT` messages. */
export const ErrorCodes = {
  INVALID_MESSAGE: "INVALID_MESSAGE",
  INVALID_SECRET: "INVALID_SECRET",
  ALREADY_JOINED: "ALREADY_JOINED",
  JOIN_FAILED: "JOIN_FAILED",
  /** Internal action types, or a game's `authorizeAction` said no. */
  FORBIDDEN_ACTION: "FORBIDDEN_ACTION",
  NOT_JOINED: "NOT_JOINED",
  RATE_LIMITED: "RATE_LIMITED",
  /** The game's reducer threw on the action; the state is unchanged. */
  ACTION_FAILED: "ACTION_FAILED",
} as const;

/** One of the {@link ErrorCodes}. */
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export const MessageTypes = {
  // Client -> Host
  JOIN: "JOIN",
  ACTION: "ACTION",
  PING: "PING",
  ASSETS_LOADED: "ASSETS_LOADED",

  // Host -> Client
  WELCOME: "WELCOME",
  STATE_UPDATE: "STATE_UPDATE",
  PONG: "PONG",
  RECONNECTED: "RECONNECTED",
  ERROR: "ERROR",
  ACTION_RESULT: "ACTION_RESULT",
} as const;
