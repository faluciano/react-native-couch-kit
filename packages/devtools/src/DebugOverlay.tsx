import { useState, useCallback, useRef, type CSSProperties } from "react";
import type { DebugPanelData } from "@couch-kit/client";

export interface DebugOverlayProps {
  /** Debug panel data from useDebugPanel hook */
  data: DebugPanelData;
  /** Initial collapsed state */
  defaultCollapsed?: boolean;
  /** Position on screen */
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  /** Maximum height of the panel */
  maxHeight?: number;
}

const STATUS_COLORS: Record<string, string> = {
  connected: "#4ade80",
  connecting: "#facc15",
  reconnecting: "#facc15",
  disconnected: "#f87171",
  error: "#f87171",
};

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  return (
    date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }) +
    "." +
    String(date.getMilliseconds()).padStart(3, "0")
  );
}

function JsonTree({ data, depth = 0 }: { data: unknown; depth?: number }) {
  if (data === null || data === undefined) {
    return <span style={{ color: "#9ca3af" }}>{String(data)}</span>;
  }

  if (typeof data === "boolean") {
    return <span style={{ color: "#c084fc" }}>{String(data)}</span>;
  }

  if (typeof data === "number") {
    return <span style={{ color: "#60a5fa" }}>{data}</span>;
  }

  if (typeof data === "string") {
    return <span style={{ color: "#4ade80" }}>&quot;{data}&quot;</span>;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return <span>{"[]"}</span>;
    return (
      <span>
        {"[\n"}
        {data.map((item, i) => (
          <span key={i}>
            {"  ".repeat(depth + 1)}
            <JsonTree data={item} depth={depth + 1} />
            {i < data.length - 1 ? "," : ""}
            {"\n"}
          </span>
        ))}
        {"  ".repeat(depth)}
        {"]"}
      </span>
    );
  }

  if (typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) return <span>{"{}"}</span>;
    return (
      <span>
        {"{\n"}
        {entries.map(([key, value], i) => (
          <span key={key}>
            {"  ".repeat(depth + 1)}
            <span style={{ color: "#93c5fd" }}>{key}</span>
            {": "}
            <JsonTree data={value} depth={depth + 1} />
            {i < entries.length - 1 ? "," : ""}
            {"\n"}
          </span>
        ))}
        {"  ".repeat(depth)}
        {"}"}
      </span>
    );
  }

  return <span>{String(data)}</span>;
}

export function DebugOverlay({
  data,
  defaultCollapsed = true,
  position = "bottom-right",
  maxHeight = 400,
}: DebugOverlayProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [activeTab, setActiveTab] = useState<"actions" | "state">("actions");
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleToggle = useCallback(() => {
    tapCountRef.current++;

    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current);
    }

    tapTimerRef.current = setTimeout(() => {
      tapCountRef.current = 0;
    }, 300);

    setCollapsed((prev) => !prev);
  }, []);

  // Early exit: nothing to render when debug is disabled
  if (!data.enabled) return null;

  const positionStyles: CSSProperties = {
    position: "fixed",
    zIndex: 99999,
    ...(position.includes("top") ? { top: 8 } : { bottom: 8 }),
    ...(position.includes("left") ? { left: 8 } : { right: 8 }),
  };

  const statusColor = STATUS_COLORS[data.connectionStatus] ?? "#9ca3af";

  const panelStyle: CSSProperties = {
    ...positionStyles,
    fontFamily:
      "'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace",
    fontSize: 11,
    lineHeight: 1.4,
    color: "#e5e7eb",
    backgroundColor: "rgba(17, 24, 39, 0.95)",
    border: "1px solid rgba(75, 85, 99, 0.6)",
    borderRadius: 8,
    overflow: "hidden",
    width: collapsed ? "auto" : 360,
    backdropFilter: "blur(8px)",
    boxShadow: "0 4px 24px rgba(0, 0, 0, 0.4)",
  };

  const buttonStyle: CSSProperties = {
    background: "none",
    border: "none",
    color: "#e5e7eb",
    cursor: "pointer",
    padding: "6px 10px",
    fontSize: 11,
    fontFamily: "inherit",
  };

  const tabStyle = (isActive: boolean): CSSProperties => ({
    ...buttonStyle,
    borderBottom: isActive ? "2px solid #60a5fa" : "2px solid transparent",
    color: isActive ? "#60a5fa" : "#9ca3af",
    paddingBottom: 4,
  });

  if (collapsed) {
    return (
      <div style={positionStyles}>
        <button
          onClick={handleToggle}
          style={{
            ...buttonStyle,
            backgroundColor: "rgba(17, 24, 39, 0.95)",
            border: "1px solid rgba(75, 85, 99, 0.6)",
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            backdropFilter: "blur(8px)",
            boxShadow: "0 2px 12px rgba(0, 0, 0, 0.3)",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: statusColor,
              display: "inline-block",
            }}
          />
          <span>Debug</span>
          {data.rtt !== null && (
            <span style={{ color: "#9ca3af" }}>{data.rtt}ms</span>
          )}
        </button>
      </div>
    );
  }

  const latestState =
    data.stateHistory.length > 0
      ? data.stateHistory[data.stateHistory.length - 1]?.state
      : null;

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 10px",
          borderBottom: "1px solid rgba(75, 85, 99, 0.4)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: statusColor,
              display: "inline-block",
            }}
          />
          <span style={{ fontWeight: 600 }}>Debug</span>
          <span style={{ color: "#9ca3af" }}>
            {data.connectionStatus}
            {data.rtt !== null ? ` · ${data.rtt}ms` : ""}
          </span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={data.clearHistory} style={buttonStyle} title="Clear">
            ✕
          </button>
          <button onClick={handleToggle} style={buttonStyle} title="Collapse">
            ▾
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: "1px solid rgba(75, 85, 99, 0.4)",
          padding: "0 6px",
        }}
      >
        <button
          onClick={() => setActiveTab("actions")}
          style={tabStyle(activeTab === "actions")}
        >
          Actions ({data.actionLog.length})
        </button>
        <button
          onClick={() => setActiveTab("state")}
          style={tabStyle(activeTab === "state")}
        >
          State
        </button>
      </div>

      {/* Content */}
      <div
        style={{
          maxHeight,
          overflowY: "auto",
          padding: 8,
        }}
      >
        {activeTab === "actions" && (
          <div>
            {data.actionLog.length === 0 ? (
              <div
                style={{
                  color: "#6b7280",
                  textAlign: "center",
                  padding: 16,
                }}
              >
                No actions recorded
              </div>
            ) : (
              data.actionLog
                .slice()
                .reverse()
                .map((entry) => (
                  <div
                    key={entry.id}
                    style={{
                      padding: "4px 6px",
                      borderBottom: "1px solid rgba(75, 85, 99, 0.2)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span
                        style={{
                          color:
                            entry.source === "local" ? "#60a5fa" : "#4ade80",
                          fontSize: 10,
                          textTransform: "uppercase",
                        }}
                      >
                        {entry.source}
                      </span>
                      <span style={{ color: "#6b7280", fontSize: 10 }}>
                        {formatTimestamp(entry.timestamp)}
                      </span>
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        fontSize: 10,
                        color: "#d1d5db",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                      }}
                    >
                      <JsonTree data={entry.action} />
                    </pre>
                  </div>
                ))
            )}
          </div>
        )}

        {activeTab === "state" && (
          <pre
            style={{
              margin: 0,
              fontSize: 10,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {latestState !== null ? (
              <JsonTree data={latestState} />
            ) : (
              <span style={{ color: "#6b7280" }}>No state captured</span>
            )}
          </pre>
        )}
      </div>
    </div>
  );
}
