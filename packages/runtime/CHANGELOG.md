# @couch-kit/runtime

## 0.4.0

### Minor Changes

- [#206](https://github.com/faluciano/react-native-couch-kit/pull/206) [`9465677`](https://github.com/faluciano/react-native-couch-kit/commit/9465677b63ad58273b8c0dee98ebece5d477a074) Thanks [@faluciano](https://github.com/faluciano)! - Make state broadcasts a real throttle and harden JOIN handling.

  - `BroadcastScheduler` no longer resets its timer on every change. It was a debounce: a host updating faster than `stateThrottleMs` sent nothing until the updates paused. The first change now opens a window and everything inside it is coalesced into one broadcast when the window closes.
  - Projected games (`project`) no longer attach client actions to `STATE_UPDATE`. They leaked one player's action payload to every other player, which is what a projection exists to prevent.
  - Actions that leave state unchanged are no longer queued for the next `STATE_UPDATE`, and the queue is capped. Previously they accumulated without bound until an unrelated change flushed them all.
  - A JOIN whose socket closes while the player ID is being derived no longer touches session state. It used to cancel the player's pending removal (leaving a disconnected ghost forever) and could orphan their live connection. `HostSessionManager` gains `derivePlayerIdFor` and `registerJoin` for this; `handleJoin` is unchanged.
  - JOIN fields are sanitized: the name is trimmed, capped at 64 characters and never blank; an avatar that is not a string of at most 16 KiB is dropped (the avatar is re-sent on every state update). A non-string `avatar` is rejected as `INVALID_MESSAGE`. New exports: `sanitizePlayerName`, `sanitizePlayerAvatar`, `MAX_PLAYER_NAME_LENGTH`, `MAX_PLAYER_AVATAR_LENGTH`, `DEFAULT_PLAYER_NAME`.

## 0.3.0

### Minor Changes

- [#164](https://github.com/faluciano/react-native-couch-kit/pull/164) [`a157126`](https://github.com/faluciano/react-native-couch-kit/commit/a157126424e4d73dcc7185118d5be0db6719792e) Thanks [@faluciano](https://github.com/faluciano)! - Send a projected state update as one relay frame instead of one per player

  A game with a `project` function sends every player their own view, which meant
  one WebSocket frame per player for every state change. Relays bill and
  rate-limit per inbound frame, so a four-player table paid four messages for one
  update and spent four of the display's 30-per-second budget.

  `GameRuntimeTransport` gains an optional `sendMany(entries)`. When a transport
  implements it, the runtime hands over the whole projected batch at once;
  transports that do not — the LAN WebSocket path — keep receiving one `send` per
  connection and are unaffected.

  `RelayDisplayHost` implements it with a new `DATA_MULTI` envelope carrying a
  peer-id-to-payload map, which the relay unpacks into ordinary `DATA` frames.
  Phones need no update — nothing on the client side can tell a batched update
  from a unicast one. If the combined frame would exceed the relay's 256KB
  ceiling, the display falls back to individual frames rather than send something
  the relay would drop.

  Relays must be updated before displays: both bundled implementations
  (`services/relay`, `services/relay-worker`) understand `DATA_MULTI`, and an
  older relay answers it with `MALFORMED`. The type is host-only — a phone sending
  it is rejected, so it cannot be used to reach another phone directly.

### Patch Changes

- Updated dependencies [[`a157126`](https://github.com/faluciano/react-native-couch-kit/commit/a157126424e4d73dcc7185118d5be0db6719792e)]:
  - @couch-kit/core@0.10.0

## 0.2.0

### Minor Changes

- [#155](https://github.com/faluciano/react-native-couch-kit/pull/155) [`4f297a1`](https://github.com/faluciano/react-native-couch-kit/commit/4f297a19c442541703c3bee7bee26354ae3476a4) Thanks [@faluciano](https://github.com/faluciano)! - Hidden information can now be hidden for real: `GameHostRuntimeConfig` takes an
  optional `project(state, playerId)` that narrows the authoritative state to what
  one player may see.

  Without it the runtime broadcasts the same state to everyone, so hiding a hand
  depends on the client choosing not to look — any player could read opponents'
  cards from devtools. With it, the data never reaches their device: the runtime
  sends each connection its own projection, in `WELCOME`, `RECONNECTED`, and every
  state update.

  Games with no hidden information omit `project` and are unchanged — state is
  still broadcast in one frame.

  Because a projected client holds a _view_ rather than the whole state, it cannot
  run the game reducer, so `ClientConfig.reducer` is now optional. Omit it and the
  client renders what the host sends (no optimistic updates); a round trip is
  imperceptible for turn-based games, and it is what makes the guarantee real.

## 0.1.0

### Minor Changes

- [#122](https://github.com/faluciano/react-native-couch-kit/pull/122) [`ec8a0ae`](https://github.com/faluciano/react-native-couch-kit/commit/ec8a0ae2626fce135d553e88eca1f0ad59d54e2d) Thanks [@faluciano](https://github.com/faluciano)! - Extract the authoritative game state, sessions, authorization, rate limiting,
  and broadcast scheduling into a transport-neutral runtime package. The React
  Native host now adapts its existing HTTP and WebSocket servers to that runtime
  without changing the public `GameHostProvider` API.

  The core ESM package metadata and declaration imports are also made compatible
  with Node's ESM and `NodeNext` resolution so the runtime can be consumed from
  supported Node versions.

### Patch Changes

- Updated dependencies [[`ec8a0ae`](https://github.com/faluciano/react-native-couch-kit/commit/ec8a0ae2626fce135d553e88eca1f0ad59d54e2d)]:
  - @couch-kit/core@0.9.3
