import { describe, expect, test } from "bun:test";
import { normalizeRoomCode, describeRelayError } from "../src/relay-room";
import { RelayErrorCodes } from "../src/relay-protocol";

describe("normalizeRoomCode", () => {
  test("upper-cases, so a typed code matches the one on screen", () => {
    expect(normalizeRoomCode("ab12")).toBe("AB12");
  });

  test("drops spacing and punctuation people add when copying a code", () => {
    expect(normalizeRoomCode("ab 12")).toBe("AB12");
    expect(normalizeRoomCode("AB-12")).toBe("AB12");
    expect(normalizeRoomCode(" ab12 ")).toBe("AB12");
  });

  test("an empty or punctuation-only entry normalizes to empty", () => {
    expect(normalizeRoomCode("")).toBe("");
    expect(normalizeRoomCode("---")).toBe("");
  });
});

describe("describeRelayError", () => {
  test("explains the failure a wrong code produces", () => {
    const msg = describeRelayError(RelayErrorCodes.ROOM_NOT_FOUND);
    expect(msg).toBeTruthy();
    expect(msg).toContain("code");
  });

  test("distinguishes a full room from a missing one", () => {
    expect(describeRelayError(RelayErrorCodes.ROOM_FULL)).not.toBe(
      describeRelayError(RelayErrorCodes.ROOM_NOT_FOUND),
    );
  });

  test("returns null for an ordinary drop, which is retried rather than explained", () => {
    expect(describeRelayError(null)).toBeNull();
    expect(describeRelayError("1006")).toBeNull();
  });

  test("covers every relay error code", () => {
    for (const code of Object.values(RelayErrorCodes)) {
      expect(describeRelayError(code)).toBeTruthy();
    }
  });
});
