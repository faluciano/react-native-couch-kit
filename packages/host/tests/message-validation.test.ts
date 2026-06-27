import { describe, expect, test } from "bun:test";
import { MessageTypes } from "@couch-kit/core";
import { isValidClientMessage } from "../src/message-validation";

describe("isValidClientMessage", () => {
  test("accepts valid client messages", () => {
    expect(
      isValidClientMessage({
        type: MessageTypes.JOIN,
        payload: { name: "Alice", secret: "not-validated-here" },
      }),
    ).toBe(true);
    expect(
      isValidClientMessage({
        type: MessageTypes.ACTION,
        payload: { type: "BUZZ", payload: { value: 1 } },
      }),
    ).toBe(true);
    expect(
      isValidClientMessage({
        type: MessageTypes.PING,
        payload: { id: "ping-1", timestamp: 123 },
      }),
    ).toBe(true);
    expect(
      isValidClientMessage({
        type: MessageTypes.ASSETS_LOADED,
        payload: true,
      }),
    ).toBe(true);
  });

  test("preserves existing JOIN validation by requiring only a name shape", () => {
    expect(
      isValidClientMessage({
        type: MessageTypes.JOIN,
        payload: { name: "Alice" },
      }),
    ).toBe(true);
  });

  test("rejects invalid message shapes", () => {
    const invalidMessages: unknown[] = [
      null,
      undefined,
      "JOIN",
      42,
      {},
      { type: 123 },
      { type: "UNKNOWN", payload: {} },
      { type: MessageTypes.JOIN },
      { type: MessageTypes.JOIN, payload: null },
      { type: MessageTypes.JOIN, payload: { name: 123 } },
      { type: MessageTypes.ACTION, payload: null },
      { type: MessageTypes.ACTION, payload: { type: 123 } },
      { type: MessageTypes.PING, payload: { id: "ping-1" } },
      { type: MessageTypes.PING, payload: { id: 123, timestamp: 123 } },
      { type: MessageTypes.PING, payload: { id: "ping-1", timestamp: "123" } },
      { type: MessageTypes.ASSETS_LOADED, payload: false },
      { type: MessageTypes.ASSETS_LOADED, payload: {} },
    ];

    for (const message of invalidMessages) {
      expect(isValidClientMessage(message)).toBe(false);
    }
  });
});
