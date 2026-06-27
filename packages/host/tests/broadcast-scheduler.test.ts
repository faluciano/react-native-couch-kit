import { describe, expect, test } from "bun:test";
import { MessageTypes } from "@couch-kit/core";
import {
  BroadcastScheduler,
  DEFAULT_STATE_THROTTLE_MS,
  createStateUpdateMessage,
  type TimerScheduler,
} from "../src/broadcast-scheduler";

class FakeScheduler implements TimerScheduler<number> {
  readonly tasks = new Map<number, { callback: () => void; delayMs: number }>();
  private nextId = 1;

  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.nextId;
    this.nextId++;
    this.tasks.set(id, { callback, delayMs });
    return id;
  }

  clearTimeout(timer: number): void {
    this.tasks.delete(timer);
  }

  run(timer: number): void {
    const task = this.tasks.get(timer);
    if (!task) return;
    this.tasks.delete(timer);
    task.callback();
  }
}

describe("BroadcastScheduler", () => {
  test("coalesces rapid schedules into the latest pending broadcast", () => {
    const fake = new FakeScheduler();
    const scheduler = new BroadcastScheduler<number>({ scheduler: fake });
    const calls: string[] = [];

    scheduler.schedule(() => calls.push("first"));
    scheduler.schedule(() => calls.push("second"));

    expect(fake.tasks.size).toBe(1);
    const [timer] = Array.from(fake.tasks.keys());
    fake.run(timer);

    expect(calls).toEqual(["second"]);
    expect(scheduler.hasPendingBroadcast()).toBe(false);
  });

  test("uses the default throttle interval and accepts custom intervals", () => {
    const defaultFake = new FakeScheduler();
    const defaultScheduler = new BroadcastScheduler<number>({
      scheduler: defaultFake,
    });
    defaultScheduler.schedule(() => {});

    expect(Array.from(defaultFake.tasks.values())[0].delayMs).toBe(
      DEFAULT_STATE_THROTTLE_MS,
    );

    const customFake = new FakeScheduler();
    const customScheduler = new BroadcastScheduler<number>({
      scheduler: customFake,
      stateThrottleMs: 10,
    });
    customScheduler.schedule(() => {});

    expect(Array.from(customFake.tasks.values())[0].delayMs).toBe(10);
  });

  test("can update the throttle interval before scheduling", () => {
    const fake = new FakeScheduler();
    const scheduler = new BroadcastScheduler<number>({
      scheduler: fake,
      stateThrottleMs: 10,
    });

    scheduler.setStateThrottleMs(25);
    scheduler.schedule(() => {});

    expect(Array.from(fake.tasks.values())[0].delayMs).toBe(25);
  });
});

describe("createStateUpdateMessage", () => {
  test("omits action when no actions were queued", () => {
    const message = createStateUpdateMessage({ status: "lobby" }, [], 123);

    expect(message).toEqual({
      type: MessageTypes.STATE_UPDATE,
      payload: {
        newState: { status: "lobby" },
        timestamp: 123,
      },
    });
  });

  test("includes a single action as an object and many actions as an array", () => {
    const single = createStateUpdateMessage(
      { status: "lobby" },
      [{ type: "A" }],
      123,
    );
    const many = createStateUpdateMessage(
      { status: "lobby" },
      [{ type: "A" }, { type: "B" }],
      123,
    );

    expect(single.payload.action).toEqual({ type: "A" });
    expect(many.payload.action).toEqual([{ type: "A" }, { type: "B" }]);
  });
});
