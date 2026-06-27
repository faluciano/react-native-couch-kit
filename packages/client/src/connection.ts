import {
  MessageTypes,
  DEFAULT_WS_PORT_OFFSET,
  DEFAULT_WS_PATH,
  generateId,
  type HostMessage,
} from "@couch-kit/core";

/**
 * Framework-free connection logic for the web game client.
 *
 * These helpers contain the pure, side-effect-free decision logic that the
 * `useGameClient` hook relies on (URL derivation, reconnect/backoff scheduling,
 * session-secret recovery, and host-message routing). They are kept separate
 * from the React hook so the behavior can be unit-tested without a WebSocket or
 * a DOM.
 */

/** localStorage key under which the session-recovery secret is persisted. */
export const SESSION_SECRET_KEY = "ck_secret";

/** The subset of `WebSocket` close codes that must NOT trigger a reconnect. */
const NON_RECOVERABLE_CLOSE_CODES = new Set<number>([
  1008, // policy violation (e.g. INVALID_SECRET / FORBIDDEN_ACTION)
  1011, // internal server error
]);

/** Connection options relevant to deriving the WebSocket URL. */
export interface UrlResolutionConfig {
  /** Full WebSocket URL. When set, it is used verbatim. */
  url?: string;
  /** WebSocket port override. Defaults to the page's HTTP port + offset. */
  wsPort?: number;
}

/** The minimal shape of `window.location` needed to derive a WS URL. */
export interface LocationLike {
  protocol: string;
  hostname: string;
  port: string;
}

/**
 * Resolve the WebSocket URL to connect to.
 *
 * If `config.url` is provided it is returned as-is. Otherwise the URL is
 * derived from the current page location using the convention
 * `WS port = HTTP port + DEFAULT_WS_PORT_OFFSET` (HTTP 8080 -> WS 8082; port+1
 * is skipped to avoid Metro's 8081). Returns `null` when no URL can be
 * determined (no explicit URL and no location available).
 */
export function resolveWebSocketUrl(
  config: UrlResolutionConfig,
  location: LocationLike | null | undefined,
): string | null {
  if (config.url) return config.url;
  if (!location) return null;

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const host = location.hostname;
  const httpPort = parseInt(location.port, 10) || 80;
  const wsPort = config.wsPort || httpPort + DEFAULT_WS_PORT_OFFSET;

  return `${protocol}//${host}:${wsPort}${DEFAULT_WS_PATH}`;
}

/**
 * Compute the exponential-backoff delay (ms) for a reconnection attempt.
 *
 * `delay = min(baseDelay * 2^attempt, maxDelay)`, where `attempt` is the
 * zero-based count of reconnects already made.
 */
export function computeBackoffDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
): number {
  return Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
}

/** Inputs to the {@link shouldReconnect} decision. */
export interface ReconnectDecision {
  /** Whether the disconnect was initiated locally (manual disconnect/unmount). */
  intentionalClose: boolean;
  /** The WebSocket close code from the `close` event. */
  closeCode: number;
  /** Number of reconnection attempts already made. */
  attempts: number;
  /** Maximum number of reconnection attempts permitted. */
  maxRetries: number;
}

/**
 * Decide whether the client should attempt an automatic reconnect.
 *
 * Returns `false` for intentional closes, for non-recoverable server close
 * codes (1008 policy / 1011 internal error), or once the attempt budget is
 * exhausted; otherwise `true`.
 */
export function shouldReconnect(decision: ReconnectDecision): boolean {
  if (decision.intentionalClose) return false;
  if (NON_RECOVERABLE_CLOSE_CODES.has(decision.closeCode)) return false;
  return decision.attempts < decision.maxRetries;
}

/** The minimal storage surface used for session-secret recovery. */
export type SecretStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * Resolve the session-recovery secret.
 *
 * Reuses an existing secret from storage when present, otherwise generates a
 * new one and persists it. When storage is unavailable or throws (e.g. Safari
 * private browsing, restrictive WebViews), a fresh secret is generated without
 * persistence so a JOIN can still proceed.
 */
export function resolveSessionSecret(
  storage: SecretStorage | null | undefined,
  generate: () => string = generateId,
): string {
  try {
    if (!storage) return generate();
    const stored = storage.getItem(SESSION_SECRET_KEY);
    if (stored) return stored;
    const secret = generate();
    storage.setItem(SESSION_SECRET_KEY, secret);
    return secret;
  } catch {
    return generate();
  }
}

/**
 * A side-effect descriptor produced by {@link interpretHostMessage}. The client
 * hook executes these against React state so the routing logic itself stays
 * pure and testable.
 */
export type HostMessageEffect<S> =
  | { kind: "setPlayerId"; playerId: string }
  | { kind: "hydrate"; state: S }
  | { kind: "pong"; payload: PongPayload };

/** Payload of a `PONG` host message. */
export type PongPayload = Extract<HostMessage, { type: "PONG" }>["payload"];

/**
 * Translate a parsed host message into the ordered list of effects the client
 * should apply. Unknown/irrelevant message types (e.g. `ERROR`) yield no
 * effects.
 */
export function interpretHostMessage<S>(
  msg: HostMessage,
): HostMessageEffect<S>[] {
  switch (msg.type) {
    case MessageTypes.WELCOME:
      return [
        { kind: "setPlayerId", playerId: msg.payload.playerId },
        { kind: "hydrate", state: msg.payload.state as S },
      ];
    case MessageTypes.STATE_UPDATE:
      return [{ kind: "hydrate", state: msg.payload.newState as S }];
    case MessageTypes.PONG:
      return [{ kind: "pong", payload: msg.payload }];
    case MessageTypes.RECONNECTED:
      return [
        { kind: "setPlayerId", playerId: msg.payload.playerId },
        { kind: "hydrate", state: msg.payload.state as S },
      ];
    default:
      return [];
  }
}
