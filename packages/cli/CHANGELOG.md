# @couch-kit/cli

## 0.2.6

### Patch Changes

- Updated dependencies [[`978616b`](https://github.com/faluciano/react-native-couch-kit/commit/978616b767031e02e24fe48de8dbdf37d15be783)]:
  - @couch-kit/core@0.7.0

## 0.2.5

### Patch Changes

- [#16](https://github.com/faluciano/react-native-couch-kit/pull/16) [`86b5ff3`](https://github.com/faluciano/react-native-couch-kit/commit/86b5ff353ce9baac0c48e6a8315bbb57eb155daf) Thanks [@faluciano](https://github.com/faluciano)! - ### Phase 1: Quick Wins — Bug Fixes, Security, and Cleanup

  **Bug fixes:**
  - Fix `simulate` command: add missing `secret` to JOIN payload so bots are no longer rejected with `INVALID_SECRET`
  - Send `RECONNECTED` message (instead of `WELCOME`) when a player reconnects, enabling clients to distinguish reconnections
  - Wire `ASSETS_LOADED` end-to-end: `usePreload` now accepts an optional `sendMessage` callback to notify the host when assets finish loading; host tracks per-player asset status
  - Include dispatched action(s) in `STATE_UPDATE` broadcasts via an action queue, so clients receive the `action` field

  **Security:**
  - Replace `derivePlayerId` with SHA-256 (Web Crypto API) — the old implementation exposed the first 16 hex chars of the player secret
  - Add dual-derivation migration: host tries SHA-256 first, falls back to legacy ID for existing players
  - Add per-socket rate limiting (60 actions/second) with `RATE_LIMITED` error response
  - Cache `socketId → playerId` mapping to avoid async derivation in hot paths

  **Cleanup:**
  - Remove dead code: `buffer-utils.ts`, `declarations.d.ts`, and their test file (TCP WebSocket remnants)
  - Deprecate unused constants: `MAX_FRAME_SIZE`, `KEEPALIVE_INTERVAL`, `KEEPALIVE_TIMEOUT` (will be removed in next major)
  - Extract `DEFAULT_DISCONNECT_TIMEOUT` constant (replaces hardcoded 5-minute magic number)
  - Add configurable `disconnectTimeout` to `GameHostConfig`

  **DX improvements:**
  - Auto-detect package manager in `bundle` command (checks lock files instead of hardcoding `bun`)
  - Show build output (`stdio: "inherit"` instead of `"ignore"`)
  - Log bot WELCOME/ERROR responses in `simulate` command

- Updated dependencies [[`86b5ff3`](https://github.com/faluciano/react-native-couch-kit/commit/86b5ff353ce9baac0c48e6a8315bbb57eb155daf)]:
  - @couch-kit/core@0.6.0

## 0.2.4

### Patch Changes

- [#9](https://github.com/faluciano/react-native-couch-kit/pull/9) [`db8bbc9`](https://github.com/faluciano/react-native-couch-kit/commit/db8bbc95c3a3334c97da3e000b2c28b9c2959fb1) Thanks [@faluciano](https://github.com/faluciano)! - Add publishConfig with public access and provenance attestation to all packages. Add missing prepublishOnly build script to CLI package.

- Updated dependencies [[`db8bbc9`](https://github.com/faluciano/react-native-couch-kit/commit/db8bbc95c3a3334c97da3e000b2c28b9c2959fb1)]:
  - @couch-kit/core@0.5.1

## 0.2.3

### Patch Changes

- Updated dependencies
  - @couch-kit/core@0.5.0

## 0.2.2

### Patch Changes

- Fix `reconstructArgs` emitting undeclared `--build` flag for negated boolean options

## 0.2.1

### Patch Changes

- Updated dependencies [81a6d8d]
  - @couch-kit/core@0.4.0

## 0.2.0

### Minor Changes

- f742819: ### Added: Asset manifest generation in `bundle` command

  The `bundle` command now generates a `www-manifest.json` file listing all bundled assets. This manifest enables the new `useExtractAssets()` hook in `@couch-kit/host` to extract assets on Android without `react-native-fs`.
  - `www-manifest.json` is automatically written to the output directory
  - New `--manifest <path>` flag to also write the manifest to app source for TypeScript imports

## 0.1.2

### Patch Changes

- Updated dependencies
  - @couch-kit/core@0.3.3

## 0.1.1

### Patch Changes

- Comprehensive documentation improvements: fix inaccurate reducer examples, add TSDoc to all public APIs, expand core README with utility/constant docs, fix CLI hardcoded version and scaffold dependency, update host devDependencies.
- Updated dependencies
  - @couch-kit/core@0.3.2

## 0.1.0

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

## 0.0.7

### Patch Changes

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

- Updated dependencies [e31e980]
  - @couch-kit/core@0.3.0

## 0.0.6

### Patch Changes

- 95cafe9: Fix critical bugs and improve reliability across all packages.

  **@couch-kit/core**: Make `IGameState.status` a flexible `string` type instead of a restrictive union, allowing games to define custom phases like `"round_end"` or `"game_over"`.

  **@couch-kit/client**: Fix WELCOME message handler to hydrate state immediately on connect instead of waiting for the next STATE_UPDATE broadcast. Add `name` and `avatar` config options to `useGameClient` so games can customize player identity. Wrap `localStorage` access in try/catch for Safari private browsing and restrictive WebView compatibility.

  **@couch-kit/host**: Rewrite WebSocket frame processing with proper buffer management — process all complete frames per TCP packet instead of only the first (fixes silent data loss). Add RFC 6455 opcode handling for close frames (send close response), ping frames (respond with pong), and graceful handling of binary/unknown frames. Fix corrupt JSON no longer permanently blocking a connection. Retain post-handshake data that arrives in the same TCP packet. Improve socket ID generation from ~5-6 chars to 21 chars to eliminate collision risk. Update stale `declarations.d.ts` to match actual `react-native-nitro-http-server` import.

  **@couch-kit/cli**: Fix `simulate` command default WebSocket URL from port 8081 to 8082 to match actual server port.

- Updated dependencies [95cafe9]
  - @couch-kit/core@0.2.0

## 0.0.5

### Patch Changes

- Updated dependencies
  - @couch-kit/core@0.1.0

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
