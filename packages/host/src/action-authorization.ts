import { InternalActionTypes } from "@couch-kit/core";

/** Error codes surfaced when a client ACTION is rejected before dispatch. */
export type ActionRejectionCode = "FORBIDDEN_ACTION" | "NOT_JOINED";

/** Outcome of authorizing an inbound client ACTION message. */
export type ActionAuthorization =
  | { kind: "allow"; playerId: string }
  | { kind: "reject"; code: ActionRejectionCode; message: string };

const INTERNAL_ACTION_TYPES = new Set<string>([
  InternalActionTypes.HYDRATE,
  InternalActionTypes.PLAYER_JOINED,
  InternalActionTypes.PLAYER_LEFT,
  InternalActionTypes.PLAYER_RECONNECTED,
  InternalActionTypes.PLAYER_REMOVED,
]);

/**
 * Decide whether an inbound client ACTION may be dispatched.
 *
 * Rejects, in order:
 * - **Internal action types** — clients must not be able to inject framework
 *   actions (`__HYDRATE__`, `__PLAYER_JOINED__`, etc.) to forge state.
 * - **Un-joined sockets** — a socket with no resolved player ID never completed
 *   a JOIN, so its actions have no owner and must not mutate state.
 *
 * The decision is pure so it can be unit-tested without a WebSocket or React.
 *
 * @param actionType - The `type` field of the client's action payload.
 * @param resolvedPlayerId - The player ID cached for the socket at JOIN time, or
 *   `undefined` if the socket has not joined.
 */
export function authorizeClientAction(
  actionType: string,
  resolvedPlayerId: string | undefined,
): ActionAuthorization {
  if (INTERNAL_ACTION_TYPES.has(actionType)) {
    return {
      kind: "reject",
      code: "FORBIDDEN_ACTION",
      message: "Internal action types cannot be dispatched by clients",
    };
  }

  if (!resolvedPlayerId) {
    return {
      kind: "reject",
      code: "NOT_JOINED",
      message: "You must JOIN before dispatching actions",
    };
  }

  return { kind: "allow", playerId: resolvedPlayerId };
}
