import { describe, expect, test } from "bun:test";
import {
  RelayMessageTypes as ClientMessageTypes,
  RelayErrorCodes as ClientErrorCodes,
  RELAY_CLOSE_HOST_LEFT as CLIENT_CLOSE_HOST_LEFT,
  RELAY_CLOSE_HOST_REPLACED as CLIENT_CLOSE_HOST_REPLACED,
  RELAY_HOST_RESUME_GRACE_MS as CLIENT_HOST_RESUME_GRACE_MS,
} from "../src/relay-protocol";
import {
  RelayMessageTypes as ServerMessageTypes,
  RelayErrorCodes as ServerErrorCodes,
  MAX_MESSAGE_BYTES as SERVER_MAX_MESSAGE_BYTES,
  RELAY_CLOSE_HOST_LEFT as SERVER_CLOSE_HOST_LEFT,
  RELAY_CLOSE_HOST_REPLACED as SERVER_CLOSE_HOST_REPLACED,
  DEFAULT_LIMITS as SERVER_DEFAULT_LIMITS,
} from "../../../services/relay/src/rooms";

/**
 * The relay is deliberately dependency-free, so it keeps its own copy of the
 * wire constants rather than importing this package. That duplication is a
 * standing drift risk: the relay gained RATE_LIMITED and SERVER_BUSY when abuse
 * limits landed, and the client's copy silently went stale — a client could
 * receive a code its own types said was impossible.
 *
 * These tests are the seam. They import both copies and fail the build the
 * moment they disagree, which is cheaper than coupling the two packages.
 */
describe("relay protocol contract (client ↔ relay)", () => {
  test("message types match exactly", () => {
    expect(ClientMessageTypes).toEqual(ServerMessageTypes);
  });

  test("error codes match exactly", () => {
    expect(ClientErrorCodes).toEqual(ServerErrorCodes);
  });

  test("the host-left close code matches", () => {
    // The relay closes phones with it; the client transport has to recognize
    // it to report HOST_LEFT instead of retrying a room that is gone.
    expect(CLIENT_CLOSE_HOST_LEFT).toBe(SERVER_CLOSE_HOST_LEFT);
  });

  test("the host-replaced close code matches", () => {
    expect(CLIENT_CLOSE_HOST_REPLACED).toBe(SERVER_CLOSE_HOST_REPLACED);
  });

  test("the display and the relay agree on how long a room waits", () => {
    // The display stops retrying when it believes the room is gone. Retrying
    // past the relay's grace is wasted; giving up before it abandons a room
    // that was still there.
    expect(CLIENT_HOST_RESUME_GRACE_MS).toBe(
      SERVER_DEFAULT_LIMITS.hostResumeGraceMs,
    );
  });

  test("both sides bound messages at the same size", () => {
    // The client mirrors the runtime's DEFAULT_MAX_MESSAGE_BYTES; the relay
    // hardcodes it. A mismatch means one side rejects what the other allows.
    expect(SERVER_MAX_MESSAGE_BYTES).toBe(256 * 1024);
  });
});
