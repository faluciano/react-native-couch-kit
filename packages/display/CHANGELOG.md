# @couch-kit/display

## 0.7.0

### Minor Changes

- [#210](https://github.com/faluciano/react-native-couch-kit/pull/210) [`0810bd2`](https://github.com/faluciano/react-native-couch-kit/commit/0810bd28a55fca11eb780c9ba19e3c8e17d4086d) Thanks [@faluciano](https://github.com/faluciano)! - **New features:** `RelayDisplayHost` takes its room back after a dropped relay connection. It used to lose the room on any drop.

  When the display's network blinks, it moves to the new `reconnecting` status. It reconnects with backoff and claims the room with the resume token the relay issued at creation. Phones stay connected throughout and the room code does not change. On success it:

  - disconnects phones that left while it was away
  - connects phones that arrived, whose held JOINs follow
  - re-sends the current state to everyone

  The room ends, as before, if:

  - the relay's 30-second grace period runs out
  - the relay no longer has the room
  - the relay closed the display on purpose
  - the relay predates resumption

  Set `resume: false` to end the room on any drop. `stop()` now closes with code 1000, so the relay ends the room at once rather than holding it.

  **Migration:** `RelayDisplayStatus` gains `"reconnecting"`. An exhaustive `switch` over it needs a new case.

### Patch Changes

- Updated dependencies [[`0810bd2`](https://github.com/faluciano/react-native-couch-kit/commit/0810bd28a55fca11eb780c9ba19e3c8e17d4086d), [`0810bd2`](https://github.com/faluciano/react-native-couch-kit/commit/0810bd28a55fca11eb780c9ba19e3c8e17d4086d)]:
  - @couch-kit/client@0.16.0
  - @couch-kit/runtime@0.6.0

## 0.6.0

### Minor Changes

- [#208](https://github.com/faluciano/react-native-couch-kit/pull/208) [`99598d6`](https://github.com/faluciano/react-native-couch-kit/commit/99598d6796b0bd3042aa9f3fbd3bf44ee891b890) Thanks [@faluciano](https://github.com/faluciano)! - `RelayDisplayHost` gains `subscribeActions(listener)`, the runtime's complete action stream: the display's own dispatches, players' actions, and join/leave lifecycle actions. State updates are no longer sent through the relay while no phone has joined the game.

### Patch Changes

- Updated dependencies [[`f4b57e3`](https://github.com/faluciano/react-native-couch-kit/commit/f4b57e3fba385d18396781d22a413a1d8afcb909), [`99598d6`](https://github.com/faluciano/react-native-couch-kit/commit/99598d6796b0bd3042aa9f3fbd3bf44ee891b890), [`99598d6`](https://github.com/faluciano/react-native-couch-kit/commit/99598d6796b0bd3042aa9f3fbd3bf44ee891b890)]:
  - @couch-kit/client@0.15.1
  - @couch-kit/core@0.10.1
  - @couch-kit/runtime@0.5.0

## 0.5.0

### Minor Changes

- [#206](https://github.com/faluciano/react-native-couch-kit/pull/206) [`a438965`](https://github.com/faluciano/react-native-couch-kit/commit/a43896586f43a2f7e4811fb9c4394a25b1018d69) Thanks [@faluciano](https://github.com/faluciano)! - Make `RelayDisplayHost` aware of its relay connection.

  - New `status` (`connecting` → `open` → `closed`) and `onStatusChange` option. When the relay connection drops, every player is marked disconnected, the status becomes `closed`, and the loss is reported through `onError` — previously the display kept running with no sign that the room was gone.
  - Nothing is written to a socket that is not open. A display that dispatched before the socket opened threw from the broadcast timer.
  - Room broadcasts are skipped while no phone is in the room, saving a billed relay message per state change in an empty lobby.
  - `stateThrottleMs` defaults to 50ms here (`DEFAULT_RELAY_STATE_THROTTLE_MS`) so a continuously updating game stays inside the relay's 30 messages/second limit, which closes the display's socket when exceeded.
  - Relay errors reach `onError` as `RelayError` with the relay's `code`.

### Patch Changes

- Updated dependencies [[`ddec122`](https://github.com/faluciano/react-native-couch-kit/commit/ddec122d9e415c54f157d6998c2b719ab31586b3), [`9465677`](https://github.com/faluciano/react-native-couch-kit/commit/9465677b63ad58273b8c0dee98ebece5d477a074)]:
  - @couch-kit/client@0.15.0
  - @couch-kit/runtime@0.4.0

## 0.4.0

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

- Updated dependencies [[`a157126`](https://github.com/faluciano/react-native-couch-kit/commit/a157126424e4d73dcc7185118d5be0db6719792e), [`a157126`](https://github.com/faluciano/react-native-couch-kit/commit/a157126424e4d73dcc7185118d5be0db6719792e)]:
  - @couch-kit/runtime@0.3.0
  - @couch-kit/client@0.14.0
  - @couch-kit/core@0.10.0

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
