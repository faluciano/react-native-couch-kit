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
 * Debounced state-broadcast scheduler used by the host provider.
 * Rapid state changes are coalesced into one broadcast after the latest change.
 */
export class BroadcastScheduler<TTimer = ReturnType<typeof setTimeout>> {
  private stateThrottleMs: number;
  private readonly scheduler: TimerScheduler<TTimer>;
  private timer: TTimer | null = null;

  constructor(options: BroadcastSchedulerOptions<TTimer> = {}) {
    this.stateThrottleMs =
      options.stateThrottleMs ?? DEFAULT_STATE_THROTTLE_MS;
    this.scheduler =
      options.scheduler ??
      (defaultTimerScheduler as unknown as TimerScheduler<TTimer>);
  }

  schedule(callback: () => void): void {
    this.cancel();
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      callback();
    }, this.stateThrottleMs);
  }

  cancel(): void {
    if (this.timer) {
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
