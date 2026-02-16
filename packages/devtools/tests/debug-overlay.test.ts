import { describe, expect, test } from "bun:test";
import { DebugOverlay } from "../src/DebugOverlay";

describe("DebugOverlay", () => {
  test("is exported as a function component", () => {
    expect(typeof DebugOverlay).toBe("function");
  });
});
