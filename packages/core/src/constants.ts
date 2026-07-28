/** Shared constants for Couch Kit protocol defaults. */

import { sha256Hex } from "./sha256.js";

/** Default HTTP port for the static file server. */
export const DEFAULT_HTTP_PORT = 8080;

/** Default WebSocket port offset from the HTTP port (skips Metro on +1). */
export const DEFAULT_WS_PORT_OFFSET = 2;

/** Default WebSocket endpoint path on the host server. */
export const DEFAULT_WS_PATH = "/ws";

/** @deprecated Not used by Couch Kit internals. Will be removed in the next major version. */
export const MAX_FRAME_SIZE = 1024 * 1024;

/** Default maximum reconnection attempts for the client. */
export const DEFAULT_MAX_RETRIES = 5;

/** Default base delay (ms) for exponential backoff reconnection. */
export const DEFAULT_BASE_DELAY = 1000;

/** Default maximum delay (ms) cap for reconnection backoff. */
export const DEFAULT_MAX_DELAY = 10000;

/** Default time sync ping interval (ms) — the interval a fresh socket starts at. */
export const DEFAULT_SYNC_INTERVAL = 5000;

/**
 * Ceiling (ms) the time-sync interval backs off to once the clock estimate has
 * settled.
 *
 * Pings are the only traffic an idle table generates, and on a relay transport
 * every one of them is a billed message for the ping *and* the host's pong. The
 * offset they measure is a clock difference that does not drift on a human
 * timescale, so the fast interval only earns its cost right after connecting.
 */
export const MAX_SYNC_INTERVAL = 30000;

/** Multiplier applied to the time-sync interval after each ping, up to {@link MAX_SYNC_INTERVAL}. */
export const SYNC_BACKOFF_FACTOR = 2;

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
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }

  // Fallback: 32 hex chars from crypto.getRandomValues
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.getRandomValues === "function"
  ) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
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
 *
 * Uses the Web Crypto API (`crypto.subtle`) when available (browser / Node),
 * and a dependency-free pure-JS SHA-256 fallback otherwise (e.g. React Native
 * / Hermes, which does not expose `crypto.subtle`). Both paths produce the
 * same digest, so the derived ID is identical across host runtimes and never
 * leaks any part of the secret.
 */
export async function derivePlayerId(secret: string): Promise<string> {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.subtle?.digest === "function"
  ) {
    const data = new TextEncoder().encode(secret);
    const hash = await globalThis.crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);
  }

  // Web Crypto unavailable (React Native / Hermes) — use the pure-JS SHA-256
  // fallback. This still produces a secure one-way hash (unlike the deprecated
  // legacy derivation, which exposed the first half of the secret).
  return sha256Hex(secret).slice(0, 16);
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
