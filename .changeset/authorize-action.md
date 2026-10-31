---
"@couch-kit/core": minor
"@couch-kit/runtime": minor
"@couch-kit/client": minor
---

**New features:** Games can decide which player actions the host accepts, and players learn what happened to their actions.

- **`authorizeAction(action, playerId, state)`** runtime option, available on `GameHostProvider` and `RelayDisplayHost`. It runs for every player action after the runtime's own checks, with the action already stamped with the sender's `playerId`.
  - Return the action to apply, or a rewritten copy, for example to overwrite a player ID nested in the payload or strip a field players may not set.
  - Return `{ reject: reason }` to refuse it. The sender gets `FORBIDDEN_ACTION` with that reason.
  - It fails closed: a hook that throws or returns garbage refuses the action and reports through `onError`.
  - The result is re-stamped with the sender's ID and may not be an internal action type.
  - Host dispatches never pass through it.
- **Action results.** An `ACTION` may carry an `id`. The host then answers with the new `ACTION_RESULT { id, ok, code?, message? }` message instead of staying silent on success. On the client, `sendActionWithResult(action)` returns a promise of that verdict: `{ ok: true }`, a refusal, or `NOT_CONNECTED` / `DISCONNECTED` / `NO_RESULT`. Use it to keep a button disabled until the host has answered, so a double tap sends one action. Refusals also reach `onError`. Actions sent without an `id` behave as before.
- **Reducer failures are reported to the sender.** A player action whose reducer throws is now answered with the new `ACTION_FAILED` code.
- **New exports.**
  - Core: `ErrorCodes`, the `ErrorCode` type, `ActionResult`, `MAX_ACTION_ID_LENGTH`, and `isInternalActionType()`. The runtime and middleware now share that one list of internal action types.
  - Runtime: `AuthorizeAction`, `ActionRejection` and `isActionRejection`.
  - Client: `ClientActionErrorCodes` and `DEFAULT_ACTION_RESULT_TIMEOUT`.
- **`STATE_UPDATE.payload.action` change.** For a player action it is now the action as applied, including the sender's `playerId`.
