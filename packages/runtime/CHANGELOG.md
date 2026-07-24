# @couch-kit/runtime

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
