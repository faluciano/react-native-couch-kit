import { useState, useEffect, useRef, useCallback } from "react";
import {
  MessageTypes,
  generateId,
  DEFAULT_SYNC_INTERVAL,
  MAX_PENDING_PINGS,
} from "@couch-kit/core";
import { TransportReadyState, type ClientTransport } from "./transport";

interface TimeSyncState {
  offset: number; // Difference between server time and local time
  rtt: number; // Round Trip Time
}

/**
 * Computes the clock offset and round-trip time between client and server.
 *
 * Uses a simplified NTP-style calculation:
 * - RTT = clientReceiveTime - clientSendTime
 * - Offset = (serverTime + RTT/2) - clientReceiveTime
 *
 * @param clientSendTime - Timestamp (ms) when the PING was sent.
 * @param clientReceiveTime - Timestamp (ms) when the PONG was received.
 * @param serverTime - Server timestamp (ms) included in the PONG payload.
 * @returns An object with `offset` (ms to add to `Date.now()` for server time) and `rtt` (round-trip time in ms).
 */
// Pure logic for testing
export function calculateTimeSync(
  clientSendTime: number,
  clientReceiveTime: number,
  serverTime: number,
) {
  const rtt = clientReceiveTime - clientSendTime;
  const latency = rtt / 2;
  const expectedServerTime = serverTime + latency;
  const offset = expectedServerTime - clientReceiveTime;

  return { offset, rtt };
}

/**
 * React hook that synchronizes the client clock with the host server.
 *
 * Periodically sends PING messages over the WebSocket and processes PONG
 * responses to estimate the clock offset and round-trip time.
 *
 * This hook is used internally by `useGameClient` and does not need to be
 * called directly. Access `getServerTime()` and `rtt` from the
 * `useGameClient` return value instead.
 *
 * @param socket - The active client transport (or `null` if not yet connected).
 * @returns An object with `getServerTime` (returns estimated server time), `rtt`, and `handlePong` (callback for PONG messages).
 */
export function useServerTime(socket: ClientTransport | null) {
  const [timeSync, setTimeSync] = useState<TimeSyncState>({
    offset: 0,
    rtt: 0,
  });

  // Ref to track ping timestamps
  const pings = useRef<Map<string, number>>(new Map());

  // Function to get current server time
  const getServerTime = useCallback(() => {
    return Date.now() + timeSync.offset;
  }, [timeSync.offset]);

  // Handle PONG messages
  const handlePong = useCallback(
    (payload: { id: string; origTimestamp: number; serverTime: number }) => {
      const now = Date.now();
      const sentTime = pings.current.get(payload.id);

      if (sentTime) {
        const { offset, rtt } = calculateTimeSync(
          sentTime,
          now,
          payload.serverTime,
        );
        setTimeSync({ offset, rtt });
        pings.current.delete(payload.id);
      }
    },
    [],
  );

  // Periodic Sync
  useEffect(() => {
    if (!socket || socket.readyState !== TransportReadyState.OPEN) return;

    const sync = () => {
      // Prevent unbounded growth if PONGs are lost
      if (pings.current.size >= MAX_PENDING_PINGS) {
        const oldest = pings.current.keys().next().value;
        if (oldest !== undefined) pings.current.delete(oldest);
      }

      const id = generateId();
      const timestamp = Date.now();
      pings.current.set(id, timestamp);

      socket.send(
        JSON.stringify({
          type: MessageTypes.PING,
          payload: { id, timestamp },
        }),
      );
    };

    // Initial sync
    sync();

    const interval = setInterval(sync, DEFAULT_SYNC_INTERVAL);
    return () => clearInterval(interval);
  }, [socket]);

  return { getServerTime, rtt: timeSync.rtt, handlePong };
}
