---
"@couch-kit/core": minor
"@couch-kit/host": minor
"@couch-kit/client": minor
"@couch-kit/cli": patch
---

### Phase 1: Quick Wins — Bug Fixes, Security, and Cleanup

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
