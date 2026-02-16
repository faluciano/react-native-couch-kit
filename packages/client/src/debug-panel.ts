import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A recorded debug action entry.
 */
export interface DebugActionEntry {
  id: number;
  action: unknown;
  timestamp: number;
  source: "local" | "remote";
}

/**
 * A state history entry for debugging.
 */
export interface DebugStateEntry<S = unknown> {
  id: number;
  state: S;
  timestamp: number;
}

/**
 * Debug panel data returned by useDebugPanel.
 */
export interface DebugPanelData<S = unknown> {
  /** Whether debug mode is active */
  enabled: boolean;
  /** Log of actions (sent and received) */
  actionLog: DebugActionEntry[];
  /** History of state changes */
  stateHistory: DebugStateEntry<S>[];
  /** Current connection status */
  connectionStatus: string;
  /** Current round-trip time in ms */
  rtt: number | null;
  /** Clear all debug history */
  clearHistory: () => void;
  /** Manually log an action (e.g., from sendAction wrapper) */
  logAction: (action: unknown, source?: "local" | "remote") => void;
}

export interface UseDebugPanelOptions<S = unknown> {
  /** Whether debug capture is active */
  enabled: boolean;
  /** Current game state from useGameClient */
  state: S | null;
  /** Connection status from useGameClient */
  status: string;
  /** RTT from useGameClient */
  rtt: number;
  /** Maximum number of entries to keep in logs */
  maxEntries?: number;
}

/**
 * Hook that provides debug panel data for development.
 * Tracks state changes, connection status, and action history.
 * Designed to be consumed by DebugOverlay or custom debug UI.
 */
export function useDebugPanel<S = unknown>(
  options: UseDebugPanelOptions<S>,
): DebugPanelData<S> {
  const { enabled, state, status, rtt, maxEntries = 50 } = options;
  const nextIdRef = useRef(0);
  const prevStateRef = useRef<S | null>(null);

  const [actionLog, setActionLog] = useState<DebugActionEntry[]>([]);
  const [stateHistory, setStateHistory] = useState<DebugStateEntry<S>[]>([]);

  const clearHistory = useCallback(() => {
    setActionLog([]);
    setStateHistory([]);
    nextIdRef.current = 0;
  }, []);

  const logAction = useCallback(
    (action: unknown, source: "local" | "remote" = "local") => {
      if (!enabled) return;

      setActionLog((prev) => {
        const entry: DebugActionEntry = {
          id: nextIdRef.current++,
          action,
          timestamp: Date.now(),
          source,
        };
        const next = [...prev, entry];
        return next.length > maxEntries ? next.slice(-maxEntries) : next;
      });
    },
    [enabled, maxEntries],
  );

  // Track state changes
  useEffect(() => {
    if (!enabled || state === null || state === prevStateRef.current) return;
    prevStateRef.current = state;

    setStateHistory((prev) => {
      const entry: DebugStateEntry<S> = {
        id: nextIdRef.current++,
        state,
        timestamp: Date.now(),
      };
      const next = [...prev, entry];
      return next.length > maxEntries ? next.slice(-maxEntries) : next;
    });
  }, [enabled, state, maxEntries]);

  // Reset when disabled
  useEffect(() => {
    if (!enabled) {
      clearHistory();
      prevStateRef.current = null;
    }
  }, [enabled, clearHistory]);

  return {
    enabled,
    actionLog,
    stateHistory,
    connectionStatus: status,
    rtt: rtt > 0 ? rtt : null,
    clearHistory,
    logAction,
  };
}
