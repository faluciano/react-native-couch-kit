# @couch-kit/host

## 0.5.2

### Patch Changes

- Comprehensive documentation improvements: fix inaccurate reducer examples, add TSDoc to all public APIs, expand core README with utility/constant docs, fix CLI hardcoded version and scaffold dependency, update host devDependencies.
- Updated dependencies
  - @couch-kit/core@0.3.2

## 0.5.1

### Patch Changes

- 6387c10: fix: simplify reducer config type to accept plain `(state, action) => state`

  Both `ClientConfig.reducer` and `GameHostConfig.reducer` previously required
  `(state: S, action: A | InternalAction<S>) => S`, forcing consumers to handle
  internal actions even though the framework wraps the reducer with
  `createGameReducer` internally. The config types now accept
  `(state: S, action: A) => S`, matching how user reducers are actually written.

  Also wraps the host provider's `useReducer` call with `createGameReducer` (the
  client already did this) so internal actions are handled transparently.

## 0.5.0

### Minor Changes

- e763b56: Performance and dependency/bundle improvements

  **Dependency cleanup:**
  - Remove unused root-level dependencies (expo-\*, @react-native/assets-registry, js-sha1)
  - Move `buffer` from root to @couch-kit/host where it's actually used
  - Move `react-native-nitro-modules` to peerDependencies in @couch-kit/host
  - Remove unused `chalk` dependency from @couch-kit/cli
  - Replace `fs-extra`, `ora`, and `ws` with built-in alternatives in @couch-kit/cli

  **Bundle & tree-shaking:**
  - Add `sideEffects: false` to all library packages for better tree-shaking
  - Add modern `exports` field to all package.json files
  - Fix @couch-kit/core build target from `node` to `browser` (it's environment-agnostic)

  **Runtime performance:**
  - Throttle state broadcasts to ~30fps to reduce serialization overhead for fast-updating games
  - Replace per-event `Buffer.concat` with a growing buffer strategy in WebSocket server to reduce GC pressure
  - Replace deprecated `Buffer.slice()` with `Buffer.subarray()`

  **CLI improvements:**
  - Lazy-load CLI commands via dynamic `import()` for faster startup
  - Replace `ws` with Bun's native WebSocket
  - Replace `fs-extra` with `node:fs` built-in APIs
  - Replace `ora` with simple console output

### Patch Changes

- Updated dependencies [e763b56]
  - @couch-kit/core@0.3.1

## 0.4.0

### Minor Changes

- e31e980: Comprehensive code audit: security, correctness, performance, and type safety improvements

  **Core:**
  - Add shared constants module (ports, timeouts, frame limits, reconnection defaults)
  - Add `generateId()` utility using cryptographic randomness instead of `Math.random()`
  - Add `toErrorMessage()` for safe error extraction from unknown caught values
  - Add `InternalAction` type union and `InternalActionTypes` constants for `__HYDRATE__`, `__PLAYER_JOINED__`, `__PLAYER_LEFT__`
  - Update `createGameReducer()` to handle all internal actions with proper types (no more double-casts)
  - Expand reducer tests from 2 to 7 cases

  **Host:**
  - Rewrite `EventEmitter` as a generic class with full type safety on `on`/`off`/`once`/`emit`
  - Add WebSocket `maxFrameSize` enforcement to prevent OOM attacks
  - Add server-side keepalive pings to detect dead connections
  - Use `ManagedSocket` interface instead of mutating raw socket objects
  - Add graceful `stop()` with WebSocket close frames
  - Safe `broadcast()` and `send()` with per-socket error handling
  - Add client message validation and internal action injection prevention in provider
  - Fix WELCOME race condition using `queueMicrotask()`
  - Memoize context value to prevent unnecessary consumer re-renders
  - Add `loading` state to server hook

  **Client:**
  - Add configurable reconnection with `maxRetries`, `baseDelay`, `maxDelay` props
  - Fix stale closures via `configRef` pattern
  - Add `disconnect()` and `reconnect()` methods
  - Respect WebSocket close codes (1008, 1011 skip reconnection)
  - Add ping map TTL cleanup to prevent unbounded growth in time sync
  - Fix `usePreload` error swallowing — track and report `failedAssets`
  - Replace `JSON.stringify(assets)` dependency with stable ref comparison

  **CLI:**
  - Replace unsafe `(e as Error).message` casts with `toErrorMessage()`
  - Fix interval leak in simulate command — clear intervals on SIGINT

### Patch Changes

- Updated dependencies [e31e980]
  - @couch-kit/core@0.3.0

## 0.3.0

### Minor Changes

- 95cafe9: Fix critical bugs and improve reliability across all packages.

  **@couch-kit/core**: Make `IGameState.status` a flexible `string` type instead of a restrictive union, allowing games to define custom phases like `"round_end"` or `"game_over"`.

  **@couch-kit/client**: Fix WELCOME message handler to hydrate state immediately on connect instead of waiting for the next STATE_UPDATE broadcast. Add `name` and `avatar` config options to `useGameClient` so games can customize player identity. Wrap `localStorage` access in try/catch for Safari private browsing and restrictive WebView compatibility.

  **@couch-kit/host**: Rewrite WebSocket frame processing with proper buffer management — process all complete frames per TCP packet instead of only the first (fixes silent data loss). Add RFC 6455 opcode handling for close frames (send close response), ping frames (respond with pong), and graceful handling of binary/unknown frames. Fix corrupt JSON no longer permanently blocking a connection. Retain post-handshake data that arrives in the same TCP packet. Improve socket ID generation from ~5-6 chars to 21 chars to eliminate collision risk. Update stale `declarations.d.ts` to match actual `react-native-nitro-http-server` import.

  **@couch-kit/cli**: Fix `simulate` command default WebSocket URL from port 8081 to 8082 to match actual server port.

### Patch Changes

- Updated dependencies [95cafe9]
  - @couch-kit/core@0.2.0

## 0.2.0

### Minor Changes

- 38bc20e: Change default WebSocket port convention from HTTP+1 to HTTP+2 to avoid conflicts with Metro bundler (which uses port 8081). Add configurable `wsPort` option to client config. Both host and client now derive WS port as `httpPort + 2` by default (e.g., HTTP 8080 -> WS 8082).

## 0.1.1

### Patch Changes

- 9c2c0f5: Add `staticDir` config option to `GameHostProvider` and `useStaticServer` for overriding the default www directory path. This is required on Android where `RNFS.MainBundlePath` is undefined, so apps must extract bundled assets to the filesystem and pass the path via `staticDir`.

## 0.1.0

### Minor Changes

- - **Session Recovery:** Added support for session recovery. The client now stores a secret and sends it on join. The host tracks these secrets and restores the session (mapping the new socket to the old session).
  - **Automatic Hydration:** The client now automatically handles the `HYDRATE` action. Users no longer need to implement this in their reducer.
  - **Large Message Support:** The Host WebSocket implementation now supports messages larger than 64KB (64-bit frame lengths).

### Patch Changes

- Updated dependencies
  - @couch-kit/core@0.1.0

## 0.0.6

### Patch Changes

- Fix React Native bundling error by replacing Node.js `events` module with custom EventEmitter implementation
  - Replaced `import { EventEmitter } from "events"` with a custom lightweight EventEmitter implementation
  - Removed `events` and `@types/events` dependencies from package.json
  - Library now works out-of-the-box in React Native/Expo without Metro configuration
  - Custom EventEmitter supports: on(), once(), off(), emit(), removeAllListeners(), listenerCount()

## 0.0.5

### Patch Changes

- Fix React Native bundling error by replacing Node.js `events` module with custom EventEmitter implementation
  - Replaced `import { EventEmitter } from "events"` with a custom lightweight EventEmitter implementation
  - Removed `events` and `@types/events` dependencies from package.json
  - Library now works out-of-the-box in React Native/Expo without Metro configuration
  - Custom EventEmitter supports: on(), once(), off(), emit(), removeAllListeners(), listenerCount()

## 0.0.4

### Patch Changes

- Fix dependency resolution for @couch-kit/core

## 0.0.3

### Patch Changes

- Fix dependency mismatch: update dependencies to point to published @couch-kit/core@0.0.2

## 0.0.2

### Patch Changes

- Initial public release. Removed example apps, refactored logging, and prepared strictly typed packages for usage.
- Updated dependencies
  - @couch-kit/core@0.0.2
