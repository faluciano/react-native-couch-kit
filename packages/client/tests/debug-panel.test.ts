import { describe, expect, test } from "bun:test";
import { useDebugPanel } from "../src/debug-panel";
import type {
  DebugPanelData,
  DebugActionEntry,
  DebugStateEntry,
  UseDebugPanelOptions,
} from "../src/debug-panel";

describe("useDebugPanel", () => {
  test("is exported as a function", () => {
    expect(typeof useDebugPanel).toBe("function");
  });

  test("types are properly exported", () => {
    // Type-level checks — verify the types compile correctly
    const _options: UseDebugPanelOptions = {
      enabled: true,
      state: null,
      status: "connected",
      rtt: 42,
    };

    const _entry: DebugActionEntry = {
      id: 0,
      action: { type: "TEST" },
      timestamp: Date.now(),
      source: "local",
    };

    const _stateEntry: DebugStateEntry = {
      id: 0,
      state: {},
      timestamp: Date.now(),
    };

    expect(_options.enabled).toBe(true);
    expect(_entry.source).toBe("local");
    expect(typeof _stateEntry.timestamp).toBe("number");
  });
});
