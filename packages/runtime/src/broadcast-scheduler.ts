import { MessageTypes, type HostMessage } from "@couch-kit/core";

/** Default state broadcast throttle (~30fps). */
export const DEFAULT_STATE_THROTTLE_MS = 33;

export type StateUpdateMessage = Extract<
  HostMessage,
  { type: typeof MessageTypes.STATE_UPDATE }
>;

export interface TimerScheduler<TTimer> {
  setTimeout(callback: () => void, delayMs: number): TTimer;
  clearTimeout(timer: TTimer): void;
}

const defaultTimerScheduler: TimerScheduler<ReturnType<typeof setTimeout>> = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
};

export interface BroadcastSchedulerOptions<TTimer> {
  stateThrottleMs?: number;
  scheduler?: TimerScheduler<TTimer>;
}

/**
 * Throttled state-broadcast scheduler used by the authoritative runtime.
 *
 * The first change opens a window of `stateThrottleMs`; every change inside it
 * is coalesced into the single broadcast that fires when the window closes.
 * The window is never extended by later changes, so a host that updates
 * faster than the throttle still broadcasts once per window instead of being
 * starved until the updates pause.
 */
export class BroadcastScheduler<TTimer = ReturnType<typeof setTimeout>> {
  private stateThrottleMs: number;
  private readonly scheduler: TimerScheduler<TTimer>;
  private timer: TTimer | null = null;
  private pending: (() => void) | null = null;

  constructor(options: BroadcastSchedulerOptions<TTimer> = {}) {
    this.stateThrottleMs = options.stateThrottleMs ?? DEFAULT_STATE_THROTTLE_MS;
    this.scheduler =
      options.scheduler ??
      (defaultTimerScheduler as unknown as TimerScheduler<TTimer>);
  }

  schedule(callback: () => void): void {
    // The latest callback wins, but the window opened by the first call stands.
    this.pending = callback;
    if (this.timer !== null) return;

    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      const pending = this.pending;
      this.pending = null;
      pending?.();
    }, this.stateThrottleMs);
  }

  cancel(): void {
    this.pending = null;
    if (this.timer !== null) {
      this.scheduler.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  setStateThrottleMs(stateThrottleMs: number): void {
    this.stateThrottleMs = stateThrottleMs;
  }

  hasPendingBroadcast(): boolean {
    return this.timer !== null;
  }
}

export function createStateUpdateMessage(
  newState: unknown,
  actions: readonly unknown[],
  timestamp: number = Date.now(),
): StateUpdateMessage {
  return {
    type: MessageTypes.STATE_UPDATE,
    payload: {
      newState,
      timestamp,
      ...(actions.length === 1
        ? { action: actions[0] }
        : actions.length > 1
          ? { action: actions }
          : {}),
    },
  };
}
