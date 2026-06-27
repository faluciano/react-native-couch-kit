import { describe, expect, test } from "bun:test";
import {
  DEFAULT_DISCONNECT_TIMEOUT,
  InternalActionTypes,
  type IPlayer,
} from "@couch-kit/core";
import {
  HostSessionManager,
  type SessionTimerScheduler,
} from "../src/session-manager";

interface TestState {
  status: string;
  players: Record<string, IPlayer>;
}

class FakeScheduler implements SessionTimerScheduler<number> {
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

function createPlayer(id: string, connected = true): IPlayer {
  return {
    id,
    name: "Alice",
    isHost: false,
    connected,
  };
}

function createManager(scheduler = new FakeScheduler()) {
  return {
    scheduler,
    manager: new HostSessionManager<number>({
      scheduler,
      derivePlayerId: async (secret) => `hashed-${secret}`,
      derivePlayerIdLegacy: (secret) => `legacy-${secret}`,
    }),
  };
}

describe("HostSessionManager", () => {
  test("derives a stable player ID for the same secret", async () => {
    const { manager } = createManager();
    const secret = "secret-a";

    const first = await manager.handleJoin<TestState>(
      "socket-1",
      { name: "Alice", secret },
      {},
    );
    const second = await manager.handleJoin<TestState>(
      "socket-2",
      { name: "Alice", secret },
      {},
    );

    expect(first.playerId).toBe(`hashed-${secret}`);
    expect(second.playerId).toBe(first.playerId);
    expect(manager.getPlayerIdForSocket("socket-2")).toBe(first.playerId);
    expect(manager.getSocketIdForSecret(secret)).toBe("socket-2");
  });

  test("returns PLAYER_RECONNECTED for an existing player and treats old sockets as stale", async () => {
    const { manager } = createManager();
    const secret = "secret-a";
    const joined = await manager.handleJoin<TestState>(
      "socket-1",
      { name: "Alice", secret },
      {},
    );

    const reconnected = await manager.handleJoin<TestState>(
      "socket-2",
      { name: "Alice", secret },
      { [joined.playerId]: createPlayer(joined.playerId, false) },
    );
    const staleDisconnect = manager.handleDisconnect<TestState>("socket-1");

    expect(reconnected.playerId).toBe(joined.playerId);
    expect(reconnected.isReconnect).toBe(true);
    expect(reconnected.action).toEqual({
      type: InternalActionTypes.PLAYER_RECONNECTED,
      payload: { playerId: joined.playerId },
    });
    expect(staleDisconnect).toEqual({
      kind: "stale",
      playerId: joined.playerId,
      secret,
    });
  });

  test("uses the legacy player ID when existing state contains only the legacy ID", async () => {
    const { manager } = createManager();
    const secret = "secret-a";
    const legacyId = `legacy-${secret}`;

    const result = await manager.handleJoin<TestState>(
      "socket-1",
      { name: "Alice", secret },
      { [legacyId]: createPlayer(legacyId, false) },
    );

    expect(result.playerId).toBe(legacyId);
    expect(result.action).toEqual({
      type: InternalActionTypes.PLAYER_RECONNECTED,
      payload: { playerId: legacyId },
    });
  });

  test("classifies reconnects against latest players after async ID derivation", async () => {
    const secret = "secret-a";
    const playerId = `hashed-${secret}`;
    let resolveDerivation: (playerId: string) => void = () => {};
    let latestPlayers: TestState["players"] = {
      [playerId]: createPlayer(playerId, false),
    };
    const manager = new HostSessionManager<number>({
      scheduler: new FakeScheduler(),
      derivePlayerId: () =>
        new Promise((resolve) => {
          resolveDerivation = resolve;
        }),
      derivePlayerIdLegacy: (value) => `legacy-${value}`,
    });

    const join = manager.handleJoin<TestState>(
      "socket-1",
      { name: "Alice", secret },
      () => latestPlayers,
    );
    latestPlayers = {};
    resolveDerivation(playerId);
    const result = await join;

    expect(result.isReconnect).toBe(false);
    expect(result.action).toEqual({
      type: InternalActionTypes.PLAYER_JOINED,
      payload: { id: playerId, name: "Alice", avatar: undefined },
    });
  });

  test("schedules PLAYER_REMOVED after the default five-minute disconnect timeout", async () => {
    const { manager, scheduler } = createManager();
    const secret = "secret-a";
    const joined = await manager.handleJoin<TestState>(
      "socket-1",
      { name: "Alice", secret },
      {},
    );
    const disconnect = manager.handleDisconnect<TestState>("socket-1");
    const removed: string[] = [];

    expect(disconnect.kind).toBe("left");
    if (disconnect.kind !== "left") return;

    manager.scheduleRemoval(disconnect.playerId, disconnect.secret, (playerId) => {
      removed.push(playerId);
    });

    expect(scheduler.tasks.size).toBe(1);
    const [timer, task] = Array.from(scheduler.tasks.entries())[0];
    expect(task.delayMs).toBe(DEFAULT_DISCONNECT_TIMEOUT);

    scheduler.run(timer);

    expect(removed).toEqual([joined.playerId]);
    expect(manager.getSocketIdForSecret(secret)).toBeUndefined();
  });

  test("cancels pending removal when the player reconnects before timeout", async () => {
    const { manager, scheduler } = createManager();
    const secret = "secret-a";
    const joined = await manager.handleJoin<TestState>(
      "socket-1",
      { name: "Alice", secret },
      {},
    );
    const disconnect = manager.handleDisconnect<TestState>("socket-1");
    const removed: string[] = [];

    expect(disconnect.kind).toBe("left");
    if (disconnect.kind !== "left") return;

    manager.scheduleRemoval(disconnect.playerId, disconnect.secret, (playerId) => {
      removed.push(playerId);
    });
    await manager.handleJoin<TestState>(
      "socket-2",
      { name: "Alice", secret },
      { [joined.playerId]: createPlayer(joined.playerId, false) },
    );

    expect(scheduler.tasks.size).toBe(0);
    expect(removed).toEqual([]);
    expect(manager.getSocketIdForSecret(secret)).toBe("socket-2");
  });
});
