import {
  DEFAULT_DISCONNECT_TIMEOUT,
  InternalActionTypes,
  derivePlayerId,
  derivePlayerIdLegacy,
  type IGameState,
  type InternalAction,
} from "@couch-kit/core";

export interface SessionTimerScheduler<TTimer> {
  setTimeout(callback: () => void, delayMs: number): TTimer;
  clearTimeout(timer: TTimer): void;
}

const defaultSessionTimerScheduler: SessionTimerScheduler<
  ReturnType<typeof setTimeout>
> = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
};

export interface JoinSessionPayload {
  name: string;
  avatar?: string;
  secret: string;
}

export interface HostSessionManagerOptions<TTimer> {
  disconnectTimeout?: number;
  getDisconnectTimeout?: () => number;
  scheduler?: SessionTimerScheduler<TTimer>;
  derivePlayerId?: (secret: string) => Promise<string>;
  derivePlayerIdLegacy?: (secret: string) => string;
}

export type JoinSessionResult<S extends IGameState> = {
  playerId: string;
  socketId: string;
  secret: string;
  isReconnect: boolean;
  action: InternalAction<S>;
};

export type DisconnectSessionResult<S extends IGameState> =
  | { kind: "unknown" }
  | { kind: "stale"; playerId: string; secret: string }
  | {
      kind: "left";
      playerId: string;
      secret: string;
      action: InternalAction<S>;
    };

type PlayersSource<S extends IGameState> =
  | S["players"]
  | (() => S["players"]);

/**
 * Tracks host player sessions by secret and socket ID, including reconnects and
 * delayed cleanup of disconnected players.
 */
export class HostSessionManager<
  TTimer = ReturnType<typeof setTimeout>,
> {
  private readonly sessions = new Map<string, string>();
  private readonly reverseMap = new Map<string, string>();
  private readonly cleanupTimers = new Map<string, TTimer>();
  private readonly socketIdToPlayerId = new Map<string, string>();
  private readonly scheduler: SessionTimerScheduler<TTimer>;
  private readonly getDisconnectTimeout: () => number;
  private readonly derivePlayerIdFn: (secret: string) => Promise<string>;
  private readonly derivePlayerIdLegacyFn: (secret: string) => string;

  constructor(options: HostSessionManagerOptions<TTimer> = {}) {
    this.scheduler =
      options.scheduler ??
      (defaultSessionTimerScheduler as unknown as SessionTimerScheduler<TTimer>);
    this.getDisconnectTimeout =
      options.getDisconnectTimeout ??
      (() => options.disconnectTimeout ?? DEFAULT_DISCONNECT_TIMEOUT);
    this.derivePlayerIdFn = options.derivePlayerId ?? derivePlayerId;
    this.derivePlayerIdLegacyFn =
      options.derivePlayerIdLegacy ?? derivePlayerIdLegacy;
  }

  async handleJoin<S extends IGameState>(
    socketId: string,
    payload: JoinSessionPayload,
    playersSource: PlayersSource<S>,
  ): Promise<JoinSessionResult<S>> {
    const hashedId = await this.derivePlayerIdFn(payload.secret);
    const players =
      typeof playersSource === "function" ? playersSource() : playersSource;
    let playerId = hashedId;

    const legacyId = this.derivePlayerIdLegacyFn(payload.secret);
    if (!players[playerId] && players[legacyId]) {
      playerId = legacyId;
    }

    this.socketIdToPlayerId.set(socketId, playerId);
    this.sessions.set(payload.secret, socketId);
    this.reverseMap.set(socketId, payload.secret);
    this.cancelRemoval(playerId);

    const isReconnect = !!players[playerId];
    const action = isReconnect
      ? ({
          type: InternalActionTypes.PLAYER_RECONNECTED,
          payload: { playerId },
        } as InternalAction<S>)
      : ({
          type: InternalActionTypes.PLAYER_JOINED,
          payload: { id: playerId, name: payload.name, avatar: payload.avatar },
        } as InternalAction<S>);

    return {
      playerId,
      socketId,
      secret: payload.secret,
      isReconnect,
      action,
    };
  }

  handleDisconnect<S extends IGameState>(
    socketId: string,
  ): DisconnectSessionResult<S> {
    const playerId = this.socketIdToPlayerId.get(socketId);
    this.socketIdToPlayerId.delete(socketId);

    const secret = this.reverseMap.get(socketId);
    this.reverseMap.delete(socketId);

    if (!playerId || !secret) return { kind: "unknown" };

    if (this.sessions.get(secret) !== socketId) {
      return { kind: "stale", playerId, secret };
    }

    return {
      kind: "left",
      playerId,
      secret,
      action: {
        type: InternalActionTypes.PLAYER_LEFT,
        payload: { playerId },
      } as InternalAction<S>,
    };
  }

  scheduleRemoval(
    playerId: string,
    secret: string,
    onRemove: (playerId: string) => void,
  ): void {
    const timer = this.scheduler.setTimeout(() => {
      this.cleanupTimers.delete(playerId);
      this.sessions.delete(secret);
      onRemove(playerId);
    }, this.getDisconnectTimeout());

    this.cleanupTimers.set(playerId, timer);
  }

  cancelRemoval(playerId: string): void {
    const existingTimer = this.cleanupTimers.get(playerId);
    if (existingTimer) {
      this.scheduler.clearTimeout(existingTimer);
      this.cleanupTimers.delete(playerId);
    }
  }

  clearRemovalTimers(): void {
    for (const timer of this.cleanupTimers.values()) {
      this.scheduler.clearTimeout(timer);
    }
    this.cleanupTimers.clear();
  }

  getPlayerIdForSocket(socketId: string): string | undefined {
    return this.socketIdToPlayerId.get(socketId);
  }

  getSocketIdForSecret(secret: string): string | undefined {
    return this.sessions.get(secret);
  }

  hasPendingRemoval(playerId: string): boolean {
    return this.cleanupTimers.has(playerId);
  }
}
