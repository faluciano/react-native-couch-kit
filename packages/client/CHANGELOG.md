# @party-kit/client

## 0.3.0

### Minor Changes

- 95cafe9: Fix critical bugs and improve reliability across all packages.

  **@party-kit/core**: Make `IGameState.status` a flexible `string` type instead of a restrictive union, allowing games to define custom phases like `"round_end"` or `"game_over"`.

  **@party-kit/client**: Fix WELCOME message handler to hydrate state immediately on connect instead of waiting for the next STATE_UPDATE broadcast. Add `name` and `avatar` config options to `useGameClient` so games can customize player identity. Wrap `localStorage` access in try/catch for Safari private browsing and restrictive WebView compatibility.

  **@party-kit/host**: Rewrite WebSocket frame processing with proper buffer management — process all complete frames per TCP packet instead of only the first (fixes silent data loss). Add RFC 6455 opcode handling for close frames (send close response), ping frames (respond with pong), and graceful handling of binary/unknown frames. Fix corrupt JSON no longer permanently blocking a connection. Retain post-handshake data that arrives in the same TCP packet. Improve socket ID generation from ~5-6 chars to 21 chars to eliminate collision risk. Update stale `declarations.d.ts` to match actual `react-native-nitro-http-server` import.

  **@party-kit/cli**: Fix `simulate` command default WebSocket URL from port 8081 to 8082 to match actual server port.

### Patch Changes

- Updated dependencies [95cafe9]
  - @party-kit/core@0.2.0

## 0.2.0

### Minor Changes

- 38bc20e: Change default WebSocket port convention from HTTP+1 to HTTP+2 to avoid conflicts with Metro bundler (which uses port 8081). Add configurable `wsPort` option to client config. Both host and client now derive WS port as `httpPort + 2` by default (e.g., HTTP 8080 -> WS 8082).

## 0.1.0

### Minor Changes

- - **Session Recovery:** Added support for session recovery. The client now stores a secret and sends it on join. The host tracks these secrets and restores the session (mapping the new socket to the old session).
  - **Automatic Hydration:** The client now automatically handles the `HYDRATE` action. Users no longer need to implement this in their reducer.
  - **Large Message Support:** The Host WebSocket implementation now supports messages larger than 64KB (64-bit frame lengths).

### Patch Changes

- Updated dependencies
  - @party-kit/core@0.1.0

## 0.0.4

### Patch Changes

- Fix dependency resolution for @party-kit/core

## 0.0.3

### Patch Changes

- Fix dependency mismatch: update dependencies to point to published @party-kit/core@0.0.2

## 0.0.2

### Patch Changes

- Initial public release. Removed example apps, refactored logging, and prepared strictly typed packages for usage.
- Updated dependencies
  - @party-kit/core@0.0.2
