/** Shared constants for Couch Kit protocol defaults. */

/** Default HTTP port for the static file server. */
export const DEFAULT_HTTP_PORT = 8080;

/** Default WebSocket port offset from the HTTP port (skips Metro on +1). */
export const DEFAULT_WS_PORT_OFFSET = 2;

/** @deprecated Not used by Couch Kit internals. Will be removed in the next major version. */
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

/** Default timeout (ms) before a disconnected player is removed from state. */
export const DEFAULT_DISCONNECT_TIMEOUT = 5 * 60 * 1000;

/** @deprecated Not used by Couch Kit internals. Will be removed in the next major version. */
export const KEEPALIVE_INTERVAL = 30000;

/** @deprecated Not used by Couch Kit internals. Will be removed in the next major version. */
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
 * Validates that a string looks like a UUID (with or without dashes, 32+ hex chars).
 */
export function isValidSecret(secret: string): boolean {
  const hex = secret.replace(/-/g, "");
  return hex.length >= 32 && /^[0-9a-f]+$/i.test(hex);
}

/**
 * Derives a stable, public player ID from a secret UUID using SHA-256.
 *
 * Takes the first 16 hex characters of the SHA-256 hash, producing
 * a deterministic ID that cannot be reversed to recover the secret.
 */
export async function derivePlayerId(secret: string): Promise<string> {
  const data = new TextEncoder().encode(secret);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/**
 * @deprecated Legacy player ID derivation. Insecure — exposes first 16 hex chars of secret.
 * Kept temporarily for dual-derivation migration in the host. Will be removed in next major.
 */
export function derivePlayerIdLegacy(secret: string): string {
  return secret.replace(/-/g, "").slice(0, 16);
}

/**
 * Safely extract an error message from an unknown caught value.
 * In JavaScript, anything can be thrown -- this normalizes it.
 */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
