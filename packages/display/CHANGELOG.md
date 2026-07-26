# @couch-kit/display

## 0.3.0

### Minor Changes

- [#158](https://github.com/faluciano/react-native-couch-kit/pull/158) [`509ea7c`](https://github.com/faluciano/react-native-couch-kit/commit/509ea7c02aa6f2e56ebf01e781d6de74f0ded021) Thanks [@faluciano](https://github.com/faluciano)! - Let the relay assign room codes

  `RelayDisplayHost`'s `roomId` is now optional. Omit it and the relay mints an
  unused six-character code, reported through the new `onRoomCode` callback and
  the `roomCode` getter.

  A display could never check its own code for collisions — only the relay knows
  which codes are live — so a self-chosen code could land on a game already in
  progress, and did so only after it was on screen. Minted codes are drawn from
  the CSPRNG over a 32-character alphabet without `O`/`0` or `I`/`1`, giving about
  1.07 billion codes.

  Existing callers that pass `roomId` keep their current behaviour, including
  `ROOM_EXISTS` when the code is taken. New callers should expect the code to
  arrive one round trip after connecting rather than being known up front:

  ```ts
  const [roomCode, setRoomCode] = useState<string | null>(null);
  new RelayDisplayHost({ url, onRoomCode: setRoomCode, reducer, initialState });
  ```

  Relays need a matching update to mint: both bundled implementations
  (`services/relay`, `services/relay-worker`) support it. A display that omits
  `roomId` against an older relay gets `MALFORMED`.

### Patch Changes

- Updated dependencies [[`509ea7c`](https://github.com/faluciano/react-native-couch-kit/commit/509ea7c02aa6f2e56ebf01e781d6de74f0ded021)]:
  - @couch-kit/client@0.13.0

## 0.2.3

### Patch Changes

- Updated dependencies [[`4f297a1`](https://github.com/faluciano/react-native-couch-kit/commit/4f297a19c442541703c3bee7bee26354ae3476a4)]:
  - @couch-kit/runtime@0.2.0
  - @couch-kit/client@0.12.0

## 0.2.2

### Patch Changes

- Updated dependencies [[`abf8bbe`](https://github.com/faluciano/react-native-couch-kit/commit/abf8bbe075e8f5eff00ffee7d9131009195c6a0e), [`abf8bbe`](https://github.com/faluciano/react-native-couch-kit/commit/abf8bbe075e8f5eff00ffee7d9131009195c6a0e)]:
  - @couch-kit/client@0.11.0

## 0.2.1

### Patch Changes

- Updated dependencies [[`050239e`](https://github.com/faluciano/react-native-couch-kit/commit/050239e251b32641b0c754016510b70ae713fcaa)]:
  - @couch-kit/client@0.10.1

## 0.2.0

### Minor Changes

- [#141](https://github.com/faluciano/react-native-couch-kit/pull/141) [`5142ccd`](https://github.com/faluciano/react-native-couch-kit/commit/5142ccdb2ef37ab85cc57eac1e50f99b567cde70) Thanks [@faluciano](https://github.com/faluciano)! - Relay connections now address the room in the URL: the socket opens against
  `<relayUrl>/r/<roomId>` instead of `<relayUrl>`, and the new `relayRoomUrl()`
  helper builds it.

  The `CREATE_ROOM` / `JOIN_ROOM` handshake is unchanged, so relays that hold
  every room in one process (the Bun reference server in `services/relay`) ignore
  the path and keep working. Putting the room in the URL lets a relay route a
  connection _before_ reading any frames, which is what per-room hosting — such as
  a Cloudflare Durable Object — requires.

  No consumer code changes: both `createRelayTransport` and `RelayDisplayHost`
  already take `roomId`, and build the URL themselves.

### Patch Changes

- Updated dependencies [[`5142ccd`](https://github.com/faluciano/react-native-couch-kit/commit/5142ccdb2ef37ab85cc57eac1e50f99b567cde70)]:
  - @couch-kit/client@0.10.0

## 0.1.2

### Patch Changes

- [#136](https://github.com/faluciano/react-native-couch-kit/pull/136) [`973805a`](https://github.com/faluciano/react-native-couch-kit/commit/973805af754a8e22c1c6c81de4c858ffa353556c) Thanks [@faluciano](https://github.com/faluciano)! - **Bundle & tree-shaking**

  - Fix `RelayDisplayHost` resolving as "not exported" for consumers on
    `moduleResolution: NodeNext`/`Node16`. The package is `type: module`, so the
    emitted `.d.ts` is read in strict-ESM mode where an extensionless relative
    re-export (`export * from "./relay-display-host"`) is not resolved. Add the
    `.js` extension to the barrel specifier, matching the other ESM packages.

## 0.1.1

### Patch Changes

- [#134](https://github.com/faluciano/react-native-couch-kit/pull/134) [`2b29581`](https://github.com/faluciano/react-native-couch-kit/commit/2b29581a8c4eddee4d4131030c375fcf1f0f4f98) Thanks [@faluciano](https://github.com/faluciano)! - **Bundle & tree-shaking**

  - Fix an empty published `dist/index.js`. With `sideEffects: false`, a named
    re-export barrel (`export { RelayDisplayHost } from …`) let bun's bundler
    tree-shake the sole class out of the built entry, so `0.1.0` shipped a bundle
    with no implementation. Use an `export *` barrel and add a post-build guard
    that fails if `RelayDisplayHost` is missing from the output.

## 0.1.0

### Minor Changes

- [#132](https://github.com/faluciano/react-native-couch-kit/pull/132) [`514d108`](https://github.com/faluciano/react-native-couch-kit/commit/514d108a57717b1bbd12d96e27c2c8f8bbb49470) Thanks [@faluciano](https://github.com/faluciano)! - **New features**

  - New `@couch-kit/display` package. `RelayDisplayHost` owns the authoritative
    `GameHostRuntime` in a browser tab and bridges it to a game-agnostic relay,
    enabling cross-network play where phones on different networks join by room
    code. Framework-agnostic (`subscribe` / `getState` / `dispatch` / `stop`);
    promoted from the in-repo reference example so games no longer vendor it.
