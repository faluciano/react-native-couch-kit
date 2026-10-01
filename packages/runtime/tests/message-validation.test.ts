import { describe, expect, test } from "bun:test";
import { MessageTypes } from "@couch-kit/core";
import {
  isValidClientMessage,
  frameByteLength,
  DEFAULT_MAX_MESSAGE_BYTES,
  DEFAULT_PLAYER_NAME,
  MAX_PLAYER_AVATAR_LENGTH,
  MAX_PLAYER_NAME_LENGTH,
  sanitizePlayerAvatar,
  sanitizePlayerName,
} from "../src/message-validation";

describe("runtime message validation", () => {
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
      { type: MessageTypes.JOIN, payload: { name: "Al", avatar: { a: 1 } } },
      { type: MessageTypes.JOIN, payload: { name: "Al", avatar: 7 } },
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

describe("frameByteLength", () => {
  test("counts ASCII strings as one byte per character", () => {
    expect(frameByteLength("")).toBe(0);
    expect(frameByteLength("hello")).toBe(5);
    expect(frameByteLength('{"type":"PING"}')).toBe(15);
  });

  test("counts multi-byte UTF-8 characters correctly", () => {
    expect(frameByteLength("é")).toBe(2); // U+00E9 -> 2 bytes
    expect(frameByteLength("€")).toBe(3); // U+20AC -> 3 bytes
    expect(frameByteLength("🎮")).toBe(4); // surrogate pair -> 4 bytes
    expect(frameByteLength("a🎮b")).toBe(6); // 1 + 4 + 1
  });

  test("matches the Web Crypto TextEncoder byte length", () => {
    const encoder = new TextEncoder();
    for (const input of ["", "abc", "héllo 🎮", "mixed €¢ 漢字 🀄"]) {
      expect(frameByteLength(input)).toBe(encoder.encode(input).length);
    }
  });

  test("uses byteLength directly for binary (ArrayBuffer) frames", () => {
    const buf = new Uint8Array([1, 2, 3, 4, 5]).buffer;
    expect(frameByteLength(buf)).toBe(5);
    expect(frameByteLength(new ArrayBuffer(0))).toBe(0);
  });

  test("exposes a sane default cap that allows normal payloads but blocks abuse", () => {
    expect(DEFAULT_MAX_MESSAGE_BYTES).toBe(256 * 1024);
    const typicalJoin = JSON.stringify({
      type: "JOIN",
      payload: { name: "Alice", avatar: "🎮", secret: "x".repeat(36) },
    });
    expect(frameByteLength(typicalJoin)).toBeLessThan(
      DEFAULT_MAX_MESSAGE_BYTES,
    );
    expect(frameByteLength("x".repeat(1_000_000))).toBeGreaterThan(
      DEFAULT_MAX_MESSAGE_BYTES,
    );
  });
});

describe("JOIN field sanitizing", () => {
  test("trims, caps, and never returns a blank name", () => {
    expect(sanitizePlayerName("  Alice  ")).toBe("Alice");
    expect(sanitizePlayerName("   ")).toBe(DEFAULT_PLAYER_NAME);
    expect(sanitizePlayerName("x".repeat(100_000))).toHaveLength(
      MAX_PLAYER_NAME_LENGTH,
    );
  });

  test("does not split a surrogate pair when truncating", () => {
    const name = sanitizePlayerName("😀".repeat(MAX_PLAYER_NAME_LENGTH + 5));
    expect(Array.from(name)).toHaveLength(MAX_PLAYER_NAME_LENGTH);
    expect(name.endsWith("😀")).toBe(true);
  });

  test("keeps small string avatars and drops everything else", () => {
    expect(sanitizePlayerAvatar("🎮")).toBe("🎮");
    expect(sanitizePlayerAvatar(undefined)).toBeUndefined();
    expect(sanitizePlayerAvatar(null)).toBeUndefined();
    expect(sanitizePlayerAvatar("")).toBeUndefined();
    expect(sanitizePlayerAvatar({ evil: true })).toBeUndefined();
    expect(
      sanitizePlayerAvatar("x".repeat(MAX_PLAYER_AVATAR_LENGTH + 1)),
    ).toBeUndefined();
  });
});
