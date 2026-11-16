import { describe, expect, test } from "bun:test";
import { createAutoTransport, isLocalNetworkHost } from "../src/auto-transport";

const tvPage = {
  protocol: "http:",
  hostname: "192.168.1.20",
  port: "8080",
  search: "",
};
const hostedPage = {
  protocol: "https:",
  hostname: "play.example.com",
  port: "",
  search: "",
};
const RELAY = "wss://relay.example.com";

describe("createAutoTransport", () => {
  test("a page served by the TV host uses the LAN socket at port + 2", () => {
    const choice = createAutoTransport({ relayUrl: RELAY, location: tvPage });
    expect(choice.kind).toBe("lan");
    if (choice.kind !== "lan") return;
    expect(choice.url).toBe("ws://192.168.1.20:8082/ws");
    expect(choice.connectionKey).toBe("lan:ws://192.168.1.20:8082/ws");
    expect(typeof choice.createTransport).toBe("function");
  });

  test("an explicit room code always selects the relay, even on the LAN", () => {
    const choice = createAutoTransport({
      relayUrl: RELAY,
      roomId: "ab-cd",
      location: tvPage,
    });
    expect(choice).toMatchObject({
      kind: "relay",
      roomId: "ABCD",
      relayUrl: RELAY,
      connectionKey: `relay:${RELAY}#ABCD`,
    });
  });

  test("?room= in the page URL selects the relay when roomId is omitted", () => {
    const choice = createAutoTransport({
      relayUrl: RELAY,
      location: { ...hostedPage, search: "?room=wxyz" },
    });
    expect(choice).toMatchObject({ kind: "relay", roomId: "WXYZ" });
  });

  test("roomId: null ignores ?room= (the app cleared it)", () => {
    const choice = createAutoTransport({
      relayUrl: RELAY,
      roomId: null,
      location: { ...hostedPage, search: "?room=wxyz" },
    });
    expect(choice).toMatchObject({ kind: "none", reason: "NEEDS_ROOM_CODE" });
  });

  test("a hosted controller with no room code needs one", () => {
    const choice = createAutoTransport({
      relayUrl: RELAY,
      location: hostedPage,
    });
    expect(choice).toEqual({
      kind: "none",
      reason: "NEEDS_ROOM_CODE",
      createTransport: undefined,
      connectionKey: null,
    });
  });

  test("a room code without a relay URL is reported, not guessed", () => {
    const choice = createAutoTransport({
      roomId: "ABCD",
      location: hostedPage,
    });
    expect(choice).toMatchObject({ kind: "none", reason: "NO_RELAY_URL" });
  });

  test("an explicit LAN url wins when there is no room", () => {
    const choice = createAutoTransport({
      url: "ws://10.0.0.5:9000/ws",
      location: hostedPage,
    });
    expect(choice).toMatchObject({ kind: "lan", url: "ws://10.0.0.5:9000/ws" });
  });

  test("works without a location (SSR)", () => {
    expect(
      createAutoTransport({ relayUrl: RELAY, location: null }),
    ).toMatchObject({ kind: "none", reason: "NEEDS_ROOM_CODE" });
  });
});

describe("isLocalNetworkHost", () => {
  test("private IPv4 ranges and .local names are local", () => {
    for (const host of [
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.10",
      "169.254.1.1",
      "living-room-tv.local",
    ]) {
      expect(isLocalNetworkHost(host)).toBe(true);
    }
  });

  test("public addresses, localhost and names are not", () => {
    for (const host of [
      "8.8.8.8",
      "172.32.0.1",
      "192.169.0.1",
      "localhost",
      "127.0.0.1",
      "play.example.com",
      "192.168.1",
      "999.168.1.1",
    ]) {
      expect(isLocalNetworkHost(host)).toBe(false);
    }
  });
});
