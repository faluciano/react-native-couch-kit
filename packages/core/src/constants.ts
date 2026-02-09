/** Shared constants for Couch Kit protocol defaults. */

/** Default HTTP port for the static file server. */
export const DEFAULT_HTTP_PORT = 8080;

/** Default WebSocket port offset from the HTTP port (skips Metro on +1). */
export const DEFAULT_WS_PORT_OFFSET = 2;

/** Maximum allowed WebSocket frame payload size (1 MB). */
export const MAX_FRAME_SIZE = 1024 * 1024;

/** Default maximum reconnection attempts for the client. */
export const DEFAULT_MAX_RETRIES = 5;

/** Default base delay (ms) for exponential backoff reconnection. */
export const DEFAULT_BASE_DELAY = 1000;

/** Default maximum delay (ms) cap for reconnection backoff. */
export const DEFAULT_MAX_DELAY = 10000;

/** Default time sync ping interval (ms). */
export const DEFAULT_SYNC_INTERVAL = 5000;

/** Maximum number of outstanding pings before cleanup. */
export const MAX_PENDING_PINGS = 50;

/** Server-side keepalive ping interval (ms). */
export const KEEPALIVE_INTERVAL = 30000;

/** Keepalive timeout -- disconnect if no pong received (ms). */
export const KEEPALIVE_TIMEOUT = 10000;

/**
 * Generate a cryptographically random ID string.
 *
 * Uses `crypto.randomUUID()` when available (browser / Node 19+),
 * falling back to `crypto.getRandomValues()` for older environments.
 */
export function generateId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  // Fallback: 32 hex chars from crypto.getRandomValues
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  // Last resort (should not happen in modern environments)
  const a = Math.random().toString(36).substring(2, 15);
  const b = Math.random().toString(36).substring(2, 10);
  return a + b;
}

/**
 * Safely extract an error message from an unknown caught value.
 * In JavaScript, anything can be thrown -- this normalizes it.
 */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
