import { describe, expect, test } from "bun:test";
import { MessageTypes, type ClientMessage, type HostMessage } from "../src/protocol";

describe("Protocol Definitions", () => {
  test("MessageTypes constants should match string values", () => {
    expect(MessageTypes.JOIN).toBe("JOIN");
    expect(MessageTypes.ACTION).toBe("ACTION");
    expect(MessageTypes.WELCOME).toBe("WELCOME");
  });

  test("ClientMessage types should be valid", () => {
    const joinMsg: ClientMessage = {
      type: "JOIN",
      payload: { name: "Test User", avatar: "🤖" }
    };
    expect(joinMsg.type).toBe(MessageTypes.JOIN);
  });

  test("HostMessage types should be valid", () => {
    const welcomeMsg: HostMessage = {
      type: "WELCOME",
      payload: {
        playerId: "123",
        state: {},
        serverTime: Date.now()
      }
    };
    expect(welcomeMsg.type).toBe(MessageTypes.WELCOME);
  });
});
