/** Maximum actions per rate-limit window. */
export const RATE_LIMIT_MAX = 60;

/** Rate-limit window duration (ms). */
export const RATE_LIMIT_WINDOW = 1000;

export interface RateLimitInfo {
  count: number;
  windowStart: number;
}

export interface RateLimitResult extends RateLimitInfo {
  allowed: boolean;
}

export interface ActionRateLimiterOptions {
  maxActions?: number;
  windowMs?: number;
  now?: () => number;
}

/**
 * Per-socket action limiter that preserves the host provider's original
 * fixed-window algorithm.
 */
export class ActionRateLimiter {
  private readonly maxActions: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly limits = new Map<string, RateLimitInfo>();

  constructor(options: ActionRateLimiterOptions = {}) {
    this.maxActions = options.maxActions ?? RATE_LIMIT_MAX;
    this.windowMs = options.windowMs ?? RATE_LIMIT_WINDOW;
    this.now = options.now ?? Date.now;
  }

  record(socketId: string): RateLimitResult {
    const now = this.now();
    let rateInfo = this.limits.get(socketId);

    if (!rateInfo || now - rateInfo.windowStart > this.windowMs) {
      rateInfo = { count: 0, windowStart: now };
      this.limits.set(socketId, rateInfo);
    }

    rateInfo.count++;

    return {
      ...rateInfo,
      allowed: rateInfo.count <= this.maxActions,
    };
  }

  reset(socketId: string): void {
    this.limits.delete(socketId);
  }

  clear(): void {
    this.limits.clear();
  }

  get(socketId: string): RateLimitInfo | undefined {
    return this.limits.get(socketId);
  }
}
