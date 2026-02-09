---
"@couch-kit/core": minor
"@couch-kit/host": minor
"@couch-kit/client": minor
"@couch-kit/cli": patch
---

Comprehensive code audit: security, correctness, performance, and type safety improvements

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
