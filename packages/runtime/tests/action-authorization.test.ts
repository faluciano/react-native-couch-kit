import { describe, expect, test } from "bun:test";
import { InternalActionTypes } from "@couch-kit/core";
import { authorizeClientAction } from "../src/action-authorization";

describe("runtime action authorization", () => {
  test("allows a normal action from a joined socket", () => {
    const result = authorizeClientAction("BUZZ", "player-123");
    expect(result).toEqual({ kind: "allow", playerId: "player-123" });
  });

  test("rejects actions from a socket that never joined", () => {
    const result = authorizeClientAction("BUZZ", undefined);
    expect(result.kind).toBe("reject");
    if (result.kind === "reject") {
      expect(result.code).toBe("NOT_JOINED");
      expect(result.message).toMatch(/JOIN/i);
    }
  });

  test.each([
    InternalActionTypes.HYDRATE,
    InternalActionTypes.PLAYER_JOINED,
    InternalActionTypes.PLAYER_LEFT,
    InternalActionTypes.PLAYER_RECONNECTED,
    InternalActionTypes.PLAYER_REMOVED,
  ])("rejects injected internal action type %s", (type) => {
    // Even with a valid playerId, internal action types are forbidden.
    const result = authorizeClientAction(type, "player-123");
    expect(result.kind).toBe("reject");
    if (result.kind === "reject") {
      expect(result.code).toBe("FORBIDDEN_ACTION");
    }
  });

  test("prioritizes FORBIDDEN over NOT_JOINED for internal actions from un-joined sockets", () => {
    const result = authorizeClientAction(
      InternalActionTypes.HYDRATE,
      undefined,
    );
    expect(result.kind).toBe("reject");
    if (result.kind === "reject") {
      expect(result.code).toBe("FORBIDDEN_ACTION");
    }
  });
});
