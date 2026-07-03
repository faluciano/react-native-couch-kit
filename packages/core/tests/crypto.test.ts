import { describe, it, expect } from "bun:test";
import { sha256Hex } from "../src/sha256";
import { derivePlayerId, derivePlayerIdLegacy } from "../src/constants";

describe("sha256Hex", () => {
  // Canonical NIST/known test vectors.
  it("hashes the empty string", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("hashes 'abc'", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashes a longer multi-block message", () => {
    expect(
      sha256Hex(
        "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      ),
    ).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("produces the same digest as the Web Crypto API (incl. UTF-8)", async () => {
    const inputs = [
      "",
      "abc",
      "the-quick-brown-fox",
      "héllo 🎮", // 2-byte and 4-byte (surrogate pair) encodings
      "x".repeat(1000), // multi-block
    ];
    for (const input of inputs) {
      const data = new TextEncoder().encode(input);
      const hash = await crypto.subtle.digest("SHA-256", data);
      const expected = Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      expect(sha256Hex(input)).toBe(expected);
    }
  });
});

describe("derivePlayerId", () => {
  const secret = "123e4567-e89b-12d3-a456-426614174000";

  it("returns a stable 16-char hex id", async () => {
    const id = await derivePlayerId(secret);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(await derivePlayerId(secret)).toBe(id);
  });

  it("matches the first 16 hex chars of the SHA-256 digest", async () => {
    const id = await derivePlayerId(secret);
    expect(id).toBe(sha256Hex(secret).slice(0, 16));
  });

  it("does NOT leak the secret (differs from legacy truncation)", async () => {
    const id = await derivePlayerId(secret);
    const legacy = derivePlayerIdLegacy(secret);
    expect(id).not.toBe(legacy);
    // The derived id must not be a prefix of the raw secret.
    expect(secret.replace(/-/g, "")).not.toStartWith(id);
  });

  it("is collision-resistant across different secrets", async () => {
    const a = await derivePlayerId("aaaaaaaa-e89b-12d3-a456-426614174000");
    const b = await derivePlayerId("bbbbbbbb-e89b-12d3-a456-426614174000");
    expect(a).not.toBe(b);
  });

  it("uses the secure pure-JS fallback when crypto.subtle is unavailable (Hermes)", async () => {
    const original = globalThis.crypto;
    try {
      // Simulate React Native / Hermes, where crypto.subtle is not exposed.
      Object.defineProperty(globalThis, "crypto", {
        value: undefined,
        configurable: true,
      });
      const id = await derivePlayerId(secret);
      // Must equal the real SHA-256 prefix — NOT the legacy secret truncation.
      expect(id).toBe(sha256Hex(secret).slice(0, 16));
      expect(id).not.toBe(derivePlayerIdLegacy(secret));
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: original,
        configurable: true,
      });
    }
  });
});
