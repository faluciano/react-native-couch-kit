import { isInternalActionType, type IAction } from "@couch-kit/core";

/** Error codes surfaced when a client ACTION is rejected before dispatch. */
export type ActionRejectionCode = "FORBIDDEN_ACTION" | "NOT_JOINED";

/** Outcome of authorizing an inbound client ACTION message. */
export type ActionAuthorization =
  | { kind: "allow"; playerId: string }
  | { kind: "reject"; code: ActionRejectionCode; message: string };

/**
 * Decide whether an inbound client ACTION may be dispatched by the runtime.
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
  if (isInternalActionType(actionType)) {
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

/**
 * What a game's `authorizeAction` returns to refuse a player's action. The
 * reason is sent to that player (as the `FORBIDDEN_ACTION` message).
 */
export interface ActionRejection {
  reject: string;
}

/** Whether an `authorizeAction` result is a {@link ActionRejection}. */
export function isActionRejection(value: unknown): value is ActionRejection {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { reject?: unknown }).reject === "string" &&
    typeof (value as { type?: unknown }).type !== "string"
  );
}

/**
 * A game's rule for which player actions the host accepts, and in what form.
 *
 * Runs for every player action after the runtime's own checks (internal types,
 * un-joined sockets), with the action already stamped with the sender's
 * `playerId`. Return the action to apply (the same one, or a rewritten copy:
 * overwrite a nested player ID with the sender's, strip a field players may not
 * set), or `{ reject: reason }` to refuse it. Host dispatches never pass
 * through here.
 *
 * Fails closed: a hook that throws, or returns something that is neither an
 * action nor a rejection, refuses the action and reports through `onError`. The
 * returned action is re-stamped with the sender's `playerId`, and may not be an
 * internal action type.
 */
export type AuthorizeAction<S, A extends IAction> = (
  action: A,
  playerId: string,
  state: S,
) => A | ActionRejection;
