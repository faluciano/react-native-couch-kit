/**
 * Room-code entry for relay clients.
 *
 * A hosted controller has no LAN host to fall back to: opened without a room
 * code it can only sit there failing. These helpers give it the missing state —
 * "which room am I trying to join, and why did the last attempt fail" — so the
 * app can ask for a code instead of hanging.
 */

import { useCallback, useState } from "react";
import { RelayErrorCodes } from "./relay-protocol";

/** Query parameter carrying the room code, as produced by display QR codes. */
const ROOM_PARAM = "room";

export interface UseRelayRoomResult {
  /** Room the client should join, or `null` when none has been chosen yet. */
  readonly roomId: string | null;
  /** Choose a room. Canonicalised, and reflected in the URL so reloads keep it. */
  readonly setRoomId: (code: string) => void;
  /** Forget the current room and return to the entry screen. */
  readonly clearRoomId: () => void;
}

/**
 * Canonical room code: upper-cased and stripped of spacing or punctuation that
 * people add when copying a code off a TV ("ab 12" and "AB-12" are `AB12`).
 */
export function normalizeRoomCode(input: string): string {
  return input.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function roomFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = new URLSearchParams(window.location.search).get(ROOM_PARAM);
    if (!raw) return null;
    const code = normalizeRoomCode(raw);
    return code.length > 0 ? code : null;
  } catch {
    return null;
  }
}

/**
 * Tracks which room this client is joining, seeded from `?room=CODE`.
 *
 * Scanning a QR fills it in; typing a code sets it and updates the URL, so a
 * reload — or a shared link — lands in the same room.
 */
export function useRelayRoom(): UseRelayRoomResult {
  const [roomId, setRoom] = useState<string | null>(() => roomFromLocation());

  const syncUrl = useCallback((code: string | null): void => {
    if (typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      if (code) url.searchParams.set(ROOM_PARAM, code);
      else url.searchParams.delete(ROOM_PARAM);
      window.history.replaceState(null, "", url.toString());
    } catch {
      // A URL we cannot rewrite is not worth failing the join over.
    }
  }, []);

  const setRoomId = useCallback(
    (code: string): void => {
      const normalized = normalizeRoomCode(code);
      if (normalized.length === 0) return;
      setRoom(normalized);
      syncUrl(normalized);
    },
    [syncUrl],
  );

  const clearRoomId = useCallback((): void => {
    setRoom(null);
    syncUrl(null);
  }, [syncUrl]);

  return { roomId, setRoomId, clearRoomId };
}

/**
 * Human-readable explanation for a relay failure, or `null` if the reason is
 * unknown (an ordinary network drop, say, which the client will retry).
 *
 * Pass `disconnectReason` from `useGameClient`.
 */
export function describeRelayError(reason: string | null): string | null {
  switch (reason) {
    case RelayErrorCodes.ROOM_NOT_FOUND:
      return "That room isn't open. Check the code on the screen.";
    case RelayErrorCodes.ROOM_FULL:
      return "That room is full.";
    case RelayErrorCodes.RATE_LIMITED:
      return "Too many messages — slow down and try again.";
    case RelayErrorCodes.ROOM_EXISTS:
      return "That room is already hosted by another screen.";
    case RelayErrorCodes.SERVER_BUSY:
      return "The relay is busy. Try again in a moment.";
    case RelayErrorCodes.MESSAGE_TOO_LARGE:
    case RelayErrorCodes.MALFORMED:
    case RelayErrorCodes.NOT_IN_ROOM:
      return "The connection was rejected. Try rejoining.";
    default:
      return null;
  }
}
