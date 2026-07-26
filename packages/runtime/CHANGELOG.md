# @couch-kit/runtime

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
