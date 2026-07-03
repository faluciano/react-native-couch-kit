import { afterEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DebugPanelData } from "@couch-kit/client";
import { DebugOverlay, type DebugOverlayProps } from "../src/DebugOverlay";

afterEach(cleanup);

function makeData(overrides: Partial<DebugPanelData> = {}): DebugPanelData {
  return {
    enabled: true,
    actionLog: [],
    stateHistory: [],
    connectionStatus: "connected",
    rtt: null,
    clearHistory: () => {},
    logAction: () => {},
    ...overrides,
  };
}

function renderOverlay(props: DebugOverlayProps) {
  return render(createElement(DebugOverlay, props));
}

describe("DebugOverlay", () => {
  test("is exported as a function", () => {
    expect(typeof DebugOverlay).toBe("function");
  });

  test("renders nothing when disabled", () => {
    const { container } = renderOverlay({ data: makeData({ enabled: false }) });
    expect(container.firstChild).toBeNull();
  });

  test("renders collapsed badge by default", () => {
    renderOverlay({ data: makeData() });
    expect(screen.getByText("Debug")).toBeDefined();
    expect(screen.queryByText("State")).toBeNull();
  });

  test("shows rtt in collapsed badge when available", () => {
    renderOverlay({ data: makeData({ rtt: 42 }) });
    expect(screen.getByText("42ms")).toBeDefined();
  });

  test("omits rtt in collapsed badge when null", () => {
    renderOverlay({ data: makeData({ rtt: null }) });
    expect(screen.queryByText(/ms$/)).toBeNull();
  });

  test("expands when the badge is clicked", () => {
    renderOverlay({ data: makeData() });
    fireEvent.click(screen.getByText("Debug"));
    expect(screen.getByText("State")).toBeDefined();
    expect(screen.getByText(/Actions \(/)).toBeDefined();
  });

  test("renders expanded with defaultCollapsed=false", () => {
    renderOverlay({ data: makeData(), defaultCollapsed: false });
    expect(screen.getByText("State")).toBeDefined();
    expect(screen.getByText("connected")).toBeDefined();
  });

  test("shows connection status and rtt in expanded header", () => {
    renderOverlay({
      data: makeData({ connectionStatus: "reconnecting", rtt: 17 }),
      defaultCollapsed: false,
    });
    expect(screen.getByText(/reconnecting/)).toBeDefined();
    expect(screen.getByText(/17ms/)).toBeDefined();
  });

  test("falls back to default color for unknown connection status", () => {
    renderOverlay({
      data: makeData({ connectionStatus: "mystery" }),
      defaultCollapsed: false,
    });
    expect(screen.getByText("mystery")).toBeDefined();
  });

  test("collapses again via the collapse button", () => {
    renderOverlay({ data: makeData(), defaultCollapsed: false });
    fireEvent.click(screen.getByTitle("Collapse"));
    expect(screen.queryByText("State")).toBeNull();
  });

  test("invokes clearHistory when clear button is clicked", () => {
    const clearHistory = mock(() => {});
    renderOverlay({
      data: makeData({ clearHistory }),
      defaultCollapsed: false,
    });
    fireEvent.click(screen.getByTitle("Clear"));
    expect(clearHistory).toHaveBeenCalledTimes(1);
  });

  test("shows empty message when there are no actions", () => {
    renderOverlay({ data: makeData(), defaultCollapsed: false });
    expect(screen.getByText("No actions recorded")).toBeDefined();
  });

  test("renders action log entries with source and json", () => {
    renderOverlay({
      data: makeData({
        actionLog: [
          {
            id: 1,
            action: { type: "PING", value: 1 },
            timestamp: Date.UTC(2024, 0, 1, 12, 30, 45, 123),
            source: "local",
          },
          {
            id: 2,
            action: { type: "PONG" },
            timestamp: Date.UTC(2024, 0, 1, 12, 30, 46, 5),
            source: "remote",
          },
        ],
      }),
      defaultCollapsed: false,
    });
    expect(screen.getByText("local")).toBeDefined();
    expect(screen.getByText("remote")).toBeDefined();
    expect(screen.getAllByText("type").length).toBeGreaterThan(0);
  });

  test("switches to the state tab and renders latest state", () => {
    renderOverlay({
      data: makeData({
        stateHistory: [
          { id: 1, state: { round: 1 }, timestamp: 0 },
          { id: 2, state: { round: 2, players: ["a"] }, timestamp: 1 },
        ],
      }),
      defaultCollapsed: false,
    });
    fireEvent.click(screen.getByText("State"));
    expect(screen.getByText("round")).toBeDefined();
    expect(screen.getByText("players")).toBeDefined();
  });

  test("shows placeholder when state tab has no captured state", () => {
    renderOverlay({ data: makeData(), defaultCollapsed: false });
    fireEvent.click(screen.getByText("State"));
    expect(screen.getByText("No state captured")).toBeDefined();
  });

  test("renders every JsonTree value type", () => {
    renderOverlay({
      data: makeData({
        stateHistory: [
          {
            id: 1,
            state: {
              nil: null,
              flag: true,
              count: 7,
              label: "hi",
              emptyArr: [],
              emptyObj: {},
              nested: [1, { deep: "x" }],
            },
            timestamp: 0,
          },
        ],
      }),
      defaultCollapsed: false,
    });
    fireEvent.click(screen.getByText("State"));
    expect(screen.getByText("null")).toBeDefined();
    expect(screen.getByText("true")).toBeDefined();
    expect(screen.getByText("7")).toBeDefined();
    expect(screen.getByText("deep")).toBeDefined();
  });

  test.each([
    ["top-left"],
    ["top-right"],
    ["bottom-left"],
    ["bottom-right"],
  ] as const)("renders with position %s", (position) => {
    const { container } = renderOverlay({
      data: makeData(),
      defaultCollapsed: false,
      position,
    });
    expect(container.firstChild).not.toBeNull();
  });
});
