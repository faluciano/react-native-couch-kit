import { describe, expect, test } from "bun:test";
import {
  ActionRateLimiter,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW,
} from "../src/rate-limiter";

describe("ActionRateLimiter", () => {
  test("allows actions up to the configured limit", () => {
    const now = 1000;
    const limiter = new ActionRateLimiter({ now: () => now });

    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      expect(limiter.record("socket-1").allowed).toBe(true);
    }

    expect(limiter.get("socket-1")).toEqual({
      count: RATE_LIMIT_MAX,
      windowStart: now,
    });
  });

  test("blocks actions over the configured limit", () => {
    const limiter = new ActionRateLimiter({ now: () => 1000 });

    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      limiter.record("socket-1");
    }

    const blocked = limiter.record("socket-1");

    expect(blocked.allowed).toBe(false);
    expect(blocked.count).toBe(RATE_LIMIT_MAX + 1);
  });

  test("resets only after the window has fully elapsed", () => {
    let now = 1000;
    const limiter = new ActionRateLimiter({ now: () => now });

    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      limiter.record("socket-1");
    }

    now += RATE_LIMIT_WINDOW;
    expect(limiter.record("socket-1").allowed).toBe(false);

    now += 1;
    const allowedAfterSlide = limiter.record("socket-1");

    expect(allowedAfterSlide.allowed).toBe(true);
    expect(allowedAfterSlide.count).toBe(1);
    expect(allowedAfterSlide.windowStart).toBe(now);
  });

  test("tracks sockets independently and can reset one socket", () => {
    const limiter = new ActionRateLimiter({ maxActions: 1, now: () => 1000 });

    expect(limiter.record("socket-1").allowed).toBe(true);
    expect(limiter.record("socket-1").allowed).toBe(false);
    expect(limiter.record("socket-2").allowed).toBe(true);

    limiter.reset("socket-1");

    expect(limiter.record("socket-1").allowed).toBe(true);
    expect(limiter.record("socket-2").allowed).toBe(false);
  });
});
