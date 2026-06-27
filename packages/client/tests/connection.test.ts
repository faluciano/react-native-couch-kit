import { describe, expect, test } from "bun:test";
import {
  resolveWebSocketUrl,
  computeBackoffDelay,
  shouldReconnect,
  resolveSessionSecret,
  interpretHostMessage,
  SESSION_SECRET_KEY,
  type SecretStorage,
  type HostMessageEffect,
} from "../src/connection";
import {
  DEFAULT_BASE_DELAY,
  DEFAULT_MAX_DELAY,
  DEFAULT_MAX_RETRIES,
  type HostMessage,
} from "@couch-kit/core";

describe("resolveWebSocketUrl", () => {
  test("returns an explicit url verbatim, ignoring location", () => {
    const url = resolveWebSocketUrl(
      { url: "ws://example.test:9999/ws" },
      { protocol: "https:", hostname: "ignored", port: "443" },
    );
    expect(url).toBe("ws://example.test:9999/ws");
  });

  test("derives ws:// from an http page using HTTP port + offset", () => {
    const url = resolveWebSocketUrl(
      {},
      { protocol: "http:", hostname: "192.168.1.10", port: "8080" },
    );
    // WS port = 8080 + 2 = 8082
    expect(url).toBe("ws://192.168.1.10:8082/ws");
  });

  test("derives wss:// for https pages", () => {
    const url = resolveWebSocketUrl(
      {},
      { protocol: "https:", hostname: "host.local", port: "8080" },
    );
    expect(url).toBe("wss://host.local:8082/ws");
  });

  test("honors an explicit wsPort override instead of deriving from location", () => {
    const url = resolveWebSocketUrl(
      { wsPort: 1234 },
      { protocol: "http:", hostname: "host.local", port: "8080" },
    );
    expect(url).toBe("ws://host.local:1234/ws");
  });

  test("falls back to port 80 when the page port is empty", () => {
    const url = resolveWebSocketUrl(
      {},
      { protocol: "http:", hostname: "host.local", port: "" },
    );
    // 80 + 2 = 82
    expect(url).toBe("ws://host.local:82/ws");
  });

  test("returns null when there is no url and no location", () => {
    expect(resolveWebSocketUrl({}, null)).toBeNull();
    expect(resolveWebSocketUrl({}, undefined)).toBeNull();
  });
});

describe("computeBackoffDelay", () => {
  test("grows exponentially from the base delay", () => {
    expect(computeBackoffDelay(0, 1000, 10000)).toBe(1000);
    expect(computeBackoffDelay(1, 1000, 10000)).toBe(2000);
    expect(computeBackoffDelay(2, 1000, 10000)).toBe(4000);
    expect(computeBackoffDelay(3, 1000, 10000)).toBe(8000);
  });

  test("caps at maxDelay", () => {
    expect(computeBackoffDelay(4, 1000, 10000)).toBe(10000);
    expect(computeBackoffDelay(10, 1000, 10000)).toBe(10000);
  });

  test("works with the package default delays", () => {
    expect(computeBackoffDelay(0, DEFAULT_BASE_DELAY, DEFAULT_MAX_DELAY)).toBe(
      1000,
    );
    expect(computeBackoffDelay(5, DEFAULT_BASE_DELAY, DEFAULT_MAX_DELAY)).toBe(
      DEFAULT_MAX_DELAY,
    );
  });
});

describe("shouldReconnect", () => {
  const base = { intentionalClose: false, closeCode: 1006, attempts: 0, maxRetries: 5 };

  test("reconnects on an abnormal close with attempts remaining", () => {
    expect(shouldReconnect(base)).toBe(true);
  });

  test("never reconnects after an intentional close", () => {
    expect(shouldReconnect({ ...base, intentionalClose: true })).toBe(false);
  });

  test("does not reconnect on policy (1008) or internal-error (1011) closes", () => {
    expect(shouldReconnect({ ...base, closeCode: 1008 })).toBe(false);
    expect(shouldReconnect({ ...base, closeCode: 1011 })).toBe(false);
  });

  test("stops once the retry budget is exhausted", () => {
    expect(shouldReconnect({ ...base, attempts: 4, maxRetries: 5 })).toBe(true);
    expect(shouldReconnect({ ...base, attempts: 5, maxRetries: 5 })).toBe(false);
    expect(shouldReconnect({ ...base, attempts: 6, maxRetries: 5 })).toBe(false);
  });

  test("intentional close takes priority over a recoverable code/attempts", () => {
    expect(
      shouldReconnect({
        intentionalClose: true,
        closeCode: 1006,
        attempts: 0,
        maxRetries: DEFAULT_MAX_RETRIES,
      }),
    ).toBe(false);
  });
});

describe("resolveSessionSecret", () => {
  function makeStorage(initial: Record<string, string> = {}): SecretStorage & {
    store: Record<string, string>;
  } {
    const store = { ...initial };
    return {
      store,
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    };
  }

  test("reuses an existing persisted secret", () => {
    const storage = makeStorage({ [SESSION_SECRET_KEY]: "existing-secret" });
    const secret = resolveSessionSecret(storage, () => "generated");
    expect(secret).toBe("existing-secret");
  });

  test("generates and persists a new secret when none exists", () => {
    const storage = makeStorage();
    const secret = resolveSessionSecret(storage, () => "generated");
    expect(secret).toBe("generated");
    expect(storage.store[SESSION_SECRET_KEY]).toBe("generated");
  });

  test("generates a fresh secret without persisting when storage is null", () => {
    const secret = resolveSessionSecret(null, () => "generated");
    expect(secret).toBe("generated");
  });

  test("generates a fresh secret when getItem throws (e.g. private mode)", () => {
    const throwing: SecretStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
    };
    expect(resolveSessionSecret(throwing, () => "fallback")).toBe("fallback");
  });

  test("generates a fresh secret when setItem throws", () => {
    const throwing: SecretStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(resolveSessionSecret(throwing, () => "fallback")).toBe("fallback");
  });

  test("defaults to generateId when no generator is supplied", () => {
    const storage = makeStorage();
    const secret = resolveSessionSecret(storage);
    expect(typeof secret).toBe("string");
    expect(secret.length).toBeGreaterThan(0);
    // and it is persisted for reuse
    expect(storage.store[SESSION_SECRET_KEY]).toBe(secret);
  });
});

describe("interpretHostMessage", () => {
  test("WELCOME sets the player id then hydrates state, in order", () => {
    const msg: HostMessage = {
      type: "WELCOME",
      payload: { playerId: "p1", state: { score: 1 }, serverTime: 123 },
    };
    const effects = interpretHostMessage<{ score: number }>(msg);
    expect(effects).toEqual([
      { kind: "setPlayerId", playerId: "p1" },
      { kind: "hydrate", state: { score: 1 } },
    ]);
  });

  test("STATE_UPDATE hydrates from newState", () => {
    const msg: HostMessage = {
      type: "STATE_UPDATE",
      payload: { newState: { score: 7 }, timestamp: 999 },
    };
    const effects = interpretHostMessage<{ score: number }>(msg);
    expect(effects).toEqual([{ kind: "hydrate", state: { score: 7 } }]);
  });

  test("RECONNECTED sets the player id then hydrates state", () => {
    const msg: HostMessage = {
      type: "RECONNECTED",
      payload: { playerId: "p9", state: { score: 3 } },
    };
    const effects = interpretHostMessage<{ score: number }>(msg);
    expect(effects).toEqual([
      { kind: "setPlayerId", playerId: "p9" },
      { kind: "hydrate", state: { score: 3 } },
    ]);
  });

  test("PONG forwards the time-sync payload", () => {
    const payload = { id: "ping-1", origTimestamp: 10, serverTime: 20 };
    const msg: HostMessage = { type: "PONG", payload };
    const effects = interpretHostMessage(msg);
    expect(effects).toEqual([{ kind: "pong", payload }]);
  });

  test("ERROR (and other non-routed messages) produce no effects", () => {
    const msg: HostMessage = {
      type: "ERROR",
      payload: { code: "INVALID_SECRET", message: "nope" },
    };
    const effects: HostMessageEffect<unknown>[] = interpretHostMessage(msg);
    expect(effects).toEqual([]);
  });
});
