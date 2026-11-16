# @couch-kit/runtime

Transport-neutral authoritative game runtime for Couch Kit hosts.

The runtime owns canonical game state, player sessions, action authorization,
rate limiting, and throttled state broadcasts. Platform packages provide the
connection transport, such as the React Native WebSocket host or a future
browser WebRTC host.

Most applications should use `@couch-kit/host` rather than constructing the
runtime directly.

## Hidden information and player actions

Both hosts (`GameHostProvider` in `@couch-kit/host`, `RelayDisplayHost` in
`@couch-kit/display`) take the runtime's config, so these options work the same
on either.

### `project(state, playerId)`

Narrows the state to what one player may see. With it, each player receives
only their own view, so hidden hands never reach other devices. Without it,
every player receives the whole state. Use it for any game with hidden
information, on **both** hosts.

### `authorizeAction(action, playerId, state)`

The game's rule for which player actions the host accepts. It runs for every
action a player sends (never for the host's own `dispatch`), after the
runtime's own checks. The action already carries the sender's `playerId`.

Return the action to apply, the same one or a rewritten copy, or
`{ reject: reason }` to refuse it. The reason is sent to that player.

```ts
const config = {
  initialState,
  reducer,
  project: createPlayerView,
  authorizeAction: (action, playerId, state) => {
    if (HOST_ONLY.has(action.type)) return { reject: "Only the TV can do that" };
    if (action.type === "GAME_ACTION") {
      // Never trust a player ID inside the payload.
      return { ...action, payload: { ...action.payload, playerId } };
    }
    return action;
  },
};
```

It fails closed. If the hook throws, or returns something that is neither an
action nor a rejection, the action is refused and the error goes to `onError`.
The returned action is re-stamped with the sender's `playerId`, and may not be
an internal action type.

### Action results

A client that sends an `ACTION` with an `id` (`sendActionWithResult` in
`@couch-kit/client`) gets an `ACTION_RESULT { id, ok, code?, message? }` back:
`ok: true` once the action is applied, or a refusal with an `ErrorCodes` code.
That code is `FORBIDDEN_ACTION` from `authorizeAction`, or `ACTION_FAILED` when
the reducer threw. Actions sent without an `id` behave as before: silence on
success, `ERROR` on refusal.

